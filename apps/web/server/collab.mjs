import { readFileSync } from "node:fs";
import { Server } from "socket.io";
import { jwtVerify } from "jose";
import * as Y from "yjs";

/**
 * The realtime room service.
 *
 * It runs inside the same Node process as the Next app, so Render's single
 * free web service is enough and the 750 free instance-hours are not spent
 * twice. The process never touches Postgres: the five-minute token minted by
 * the app route carries the board, the role, and the display name, and this
 * file only verifies the signature.
 *
 * Rooms are ephemeral. The durable copy is the REST snapshot the clients write
 * on a debounce and on pagehide; a room that empties is dropped after a grace
 * period so a refresh or a tunnel does not lose the live document.
 */

const protocol = JSON.parse(
  readFileSync(new URL("./protocol.json", import.meta.url), "utf8"),
);

const ROOM_GRACE_MS = 30_000;
const PRESENCE_INTERVAL_MS = 60;
const MAX_ROOMS = 500;

function encode(update) {
  return Buffer.from(update).toString("base64");
}

function decode(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  try {
    return new Uint8Array(Buffer.from(text, "base64"));
  } catch {
    return null;
  }
}

function cleanText(value, fallback, max) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.replace(/\s+/g, " ").trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : fallback;
}

/** Enters the collab service; returns the Socket.IO server, or null. */
export function attachCollab(httpServer) {
  const secretValue = process.env.PENPAPER_SECRET?.trim();
  if (!secretValue) {
    console.warn(
      "PenPaper: PENPAPER_SECRET is not set, so live collaboration is off. Boards still open and save locally.",
    );
    return null;
  }

  const secret = new TextEncoder().encode(secretValue);

  const io = new Server(httpServer, {
    path: protocol.path,
    serveClient: false,
    maxHttpBufferSize: protocol.limits.maxUpdateBytes,
    // A phone that sleeps should be dropped quickly enough that its cursor is
    // not left on someone else's board for minutes.
    pingInterval: 20_000,
    pingTimeout: 20_000,
    transports: ["websocket", "polling"],
  });

  /** @type {Map<string, ReturnType<typeof createRoom>>} */
  const rooms = new Map();

  function createRoom(id) {
    return {
      id,
      doc: new Y.Doc(),
      peers: new Map(),
      sockets: new Set(),
      /** Identity keys the host has removed; a room dies with its bans. */
      banned: new Set(),
      presenceTimer: null,
      closeTimer: null,
    };
  }

  function roomFor(id) {
    let room = rooms.get(id);
    if (room) {
      if (room.closeTimer) {
        clearTimeout(room.closeTimer);
        room.closeTimer = null;
      }
      return room;
    }

    if (rooms.size >= MAX_ROOMS) return null;
    room = createRoom(id);
    rooms.set(id, room);
    return room;
  }

  function presencePayload(room) {
    return {
      peers: [...room.peers.values()].map((peer) => ({
        id: peer.id,
        name: peer.name,
        color: peer.color,
        role: peer.role,
        cursor: peer.cursor,
        selection: peer.selection,
      })),
    };
  }

  /** Coalesces a burst of cursor moves into one roster per frame-ish. */
  function schedulePresence(room) {
    if (room.presenceTimer) return;
    room.presenceTimer = setTimeout(() => {
      room.presenceTimer = null;
      io.to(room.id).emit(protocol.server.presence, presencePayload(room));
    }, PRESENCE_INTERVAL_MS);
  }

  function scheduleClose(room) {
    if (room.closeTimer || room.sockets.size > 0) return;
    room.closeTimer = setTimeout(() => {
      room.closeTimer = null;
      if (room.sockets.size > 0) return;
      if (room.presenceTimer) clearTimeout(room.presenceTimer);
      room.doc.destroy();
      rooms.delete(room.id);
    }, ROOM_GRACE_MS);
  }

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== "string") return next(new Error("missing token"));

      const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
      if (typeof payload.board !== "string" || payload.board.length === 0) {
        return next(new Error("invalid token"));
      }
      if (payload.role !== "owner" && payload.role !== "editor" && payload.role !== "viewer") {
        return next(new Error("invalid token"));
      }

      const guestId =
        typeof socket.handshake.auth?.guestId === "string"
          ? cleanText(socket.handshake.auth.guestId, "", 64)
          : "";

      socket.data.identity = {
        boardId: payload.board,
        userId: typeof payload.sub === "string" ? payload.sub : "unknown",
        guestId,
        role: payload.role,
        name: cleanText(payload.name, "Guest", 60),
        color: cleanText(payload.color, "hsl(220 72% 48%)", 40),
      };
      next();
    } catch {
      next(new Error("invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const identity = socket.data.identity;
    const room = roomFor(identity.boardId);

    if (!room) {
      socket.emit(protocol.server.fatal, { error: "This server is busy. Try again in a moment." });
      socket.disconnect(true);
      return;
    }

    // What a removal is remembered by. An account survives a reload; a guest
    // survives it through the id its browser keeps.
    const key =
      identity.userId !== "unknown"
        ? `u:${identity.userId}`
        : identity.guestId
          ? `g:${identity.guestId}`
          : null;

    if (key && room.banned.has(key)) {
      socket.emit(protocol.server.fatal, {
        error: "The host removed you from this notepad.",
      });
      socket.disconnect(true);
      return;
    }

    if (room.sockets.size >= protocol.limits.maxPeers) {
      socket.emit(protocol.server.fatal, { error: "This notepad already has as many people as it can hold." });
      socket.disconnect(true);
      return;
    }

    socket.join(room.id);
    room.sockets.add(socket.id);
    room.peers.set(socket.id, {
      id: socket.id,
      key,
      name: identity.name,
      color: identity.color,
      role: identity.role,
      cursor: null,
      selection: [],
    });

    socket.emit(protocol.server.ready, {
      boardId: identity.boardId,
      role: identity.role,
      you: socket.id,
    });
    schedulePresence(room);

    socket.on(protocol.client.syncRequest, () => {
      socket.emit(protocol.server.sync, {
        update: encode(Y.encodeStateAsUpdate(room.doc)),
      });
    });

    socket.on(protocol.client.update, (message) => {
      // A viewer link is read-only on both paths. The client hides the pen; this
      // check is what makes that a rule rather than a courtesy. Presence frames
      // below stay allowed, because watching together is the point.
      if (identity.role === "viewer") return;

      const update = decode(message?.update);
      if (!update || update.byteLength === 0) return;
      if (update.byteLength > protocol.limits.maxUpdateBytes) return;

      Y.applyUpdate(room.doc, update, socket.id);
      // The sender already has this update; the rest of the room does not.
      socket.to(room.id).emit(protocol.server.update, { update: message.update });
    });

    socket.on(protocol.client.cursor, (message) => {
      const peer = room.peers.get(socket.id);
      if (!peer) return;

      const x = Number(message?.x);
      const y = Number(message?.y);
      peer.cursor = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
      schedulePresence(room);
    });

    socket.on(protocol.client.selection, (message) => {
      const peer = room.peers.get(socket.id);
      if (!peer) return;

      peer.selection = Array.isArray(message?.ids)
        ? message.ids.filter((id) => typeof id === "string").slice(0, 2_000)
        : [];
      schedulePresence(room);
    });

    // Only the host may show someone out. The check lives here, not in the
    // menu: a guest with a doctored client can ask, and the room still says no.
    socket.on(protocol.client.remove, (message) => {
      if (identity.role !== "owner") return;

      const targetId = typeof message?.id === "string" ? message.id : "";
      if (!targetId || targetId === socket.id) return;

      const target = room.peers.get(targetId);
      // The host cannot remove the host: several owner tabs are the same person.
      if (!target || target.role === "owner") return;

      // The ban outlives the socket, so a client that reconnects by itself, or
      // a refreshed tab on the same device, does not walk straight back in.
      if (target.key) room.banned.add(target.key);

      const targetSocket = io.sockets.sockets.get(targetId);
      targetSocket?.emit(protocol.server.removed, { by: identity.name });
      targetSocket?.disconnect(true);
    });

    socket.on("disconnect", () => {
      room.sockets.delete(socket.id);
      room.peers.delete(socket.id);
      schedulePresence(room);
      scheduleClose(room);
    });
  });

  io.on("error", (error) => {
    console.warn("PenPaper: collaboration socket error", error);
  });

  return io;
}
