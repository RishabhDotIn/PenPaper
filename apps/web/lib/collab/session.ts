import { io, type Socket } from "socket.io-client";
import * as Y from "yjs";
import type { Element } from "@penpaper/shared";
import { fetchCollabToken, type Role } from "./api";
import protocol from "../../server/protocol.json";

/**
 * The live half of collaboration: a Yjs document over one socket room.
 *
 * Two documents are kept. `local` is what this tab believes; `remote` mirrors
 * what the room has told us. Sending the difference between their state
 * vectors is the standard two-way sync and it is what makes reconnecting after
 * a tunnel work: the next exchange carries everything the room missed, not
 * just the last stroke.
 *
 * The unit of merge is one element. Two people drawing different shapes never
 * conflict, and two people dragging the same shape resolve to whichever copy
 * the room saw last — the same promise the Drive merge makes, and the reason
 * deletions travel as tombstones rather than disappearing keys.
 */

const ELEMENTS = "elements";

export interface CollabCursor {
  x: number;
  y: number;
}

export interface CollabPeer {
  id: string;
  name: string;
  color: string;
  role: Role;
  cursor: CollabCursor | null;
  selection: string[];
  /** True for this tab's own row, so a roster can label it instead of guessing. */
  you: boolean;
}

export type CollabStatus = "connecting" | "online" | "offline";

export interface CollabSessionOptions {
  boardId: string;
  shareToken: string | null;
  guestId: string;
  getElements: () => Element[];
  /** Elements the room changed, and ids it removed outright. */
  onRemote: (elements: Element[], removed: string[]) => void;
  /** The whole room, this tab included; `you` marks the local row. */
  onPeers: (peers: CollabPeer[]) => void;
  onStatus: (status: CollabStatus) => void;
  /** The host showed this tab out. The session is already stopping. */
  onRemoved?: (by: string) => void;
  /** A room-side refusal worth a sentence, such as a revoked link. */
  onNotice?: (message: string) => void;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // `String.fromCharCode(...bytes)` throws for a large board, so chunk it.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

interface Message {
  update?: string;
}

interface PresenceMessage {
  peers?: Omit<CollabPeer, "you">[];
}

interface ReadyMessage {
  you?: string;
}

interface NoticeMessage {
  error?: string;
  by?: string;
}

export class CollabSession {
  private readonly local = new Y.Doc();
  private readonly remote = new Y.Doc();
  private readonly map = this.local.getMap<Element>(ELEMENTS);
  /** What the scene looked like after the last exchange, to diff against. */
  private known = new Map<string, Element>();

  private socket: Socket | null = null;
  private token: { value: string; expiresAt: number } | null = null;
  /**
   * What the room token says this tab may do.
   *
   * Known before the socket connects, so a viewer never seeds the room with its
   * local copy and never sends a correction. The server enforces the same rule;
   * this keeps the viewer from generating traffic it would refuse.
   */
  private role: "owner" | "editor" | "viewer" | null = null;
  /** This socket's own id, so the presence roster does not draw us twice. */
  private you: string | null = null;
  private stopped = false;
  private lastSelection = "";
  private lastCursorAt = 0;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCursor: CollabCursor | null | undefined;

  constructor(private readonly options: CollabSessionOptions) {}

  async start(): Promise<void> {
    this.options.onStatus("connecting");

    // The role decides whether this tab may write at all, so ask before
    // seeding: a viewer must not offer its local copy to the room. The token is
    // cached for the socket's `auth` callback, which reuses it without a fetch.
    try {
      await this.getToken();
    } catch {
      // No token, no room. The board keeps working locally.
      this.options.onStatus("offline");
      return;
    }
    if (this.stopped) return;

    // Seed before the socket exists: a board opened offline still has a full
    // local document, so the first connection carries the drawing with it.
    if (this.role !== "viewer") this.writeScene(this.options.getElements());

    this.socket = io({
      path: protocol.path,
      autoConnect: false,
      auth: (callback: (data: Record<string, string>) => void) => {
        void this.credentials()
          .then((data) => callback(data))
          .catch(() => callback({}));
      },
    });

    this.socket.on("connect", () => {
      this.options.onStatus("connecting");
      this.socket?.emit(protocol.client.syncRequest);
    });

    this.socket.on(protocol.server.ready, (message: ReadyMessage) => {
      if (typeof message?.you === "string") this.you = message.you;
      this.options.onStatus("online");
      this.socket?.emit(protocol.client.syncRequest);
    });

    this.socket.on(protocol.server.sync, (message: Message) => {
      if (message?.update) this.receive(message.update);
      this.flush();
    });

    this.socket.on(protocol.server.update, (message: Message) => {
      if (message?.update) this.receive(message.update);
    });

    this.socket.on(protocol.server.presence, (message: PresenceMessage) => {
      const peers = Array.isArray(message?.peers) ? message.peers : [];
      // The roster includes this tab: the live panel says who is here, and
      // "here" is not only other people. Cursors filter the local row out.
      this.options.onPeers(peers.map((peer) => ({ ...peer, you: peer.id === this.you })));
    });

    this.socket.on(protocol.server.removed, (message: NoticeMessage) => {
      // The socket is about to be closed by the host's side; stopping first
      // keeps socket.io from reconnecting into the same refusal.
      this.options.onRemoved?.(
        typeof message?.by === "string" && message.by ? message.by : "The host",
      );
      this.options.onStatus("offline");
      this.stop();
    });

    this.socket.on(protocol.server.fatal, (message: NoticeMessage) => {
      if (typeof message?.error === "string" && message.error) {
        this.options.onNotice?.(message.error);
      }
      this.options.onStatus("offline");
    });

    this.socket.on("disconnect", () => {
      if (this.stopped) return;
      this.options.onStatus("offline");
    });

    this.socket.on("connect_error", () => {
      if (this.stopped) return;
      this.options.onStatus("offline");
    });

    if (!this.stopped) this.socket.connect();
  }

  /** Pushes the scene's current elements into the shared document. */
  push(elements: readonly Element[]): void {
    if (this.stopped || this.role === "viewer") return;
    this.writeScene(elements);
    this.known = this.readMap();
    this.flush();
  }

  cursor(point: CollabCursor | null): void {
    if (this.stopped || !this.socket?.connected) return;
    this.pendingCursor = point;

    const wait = Math.max(
      0,
      protocol.limits.cursorIntervalMs - (Date.now() - this.lastCursorAt),
    );

    if (wait === 0) {
      this.sendCursor();
      return;
    }

    if (this.cursorTimer) return;
    this.cursorTimer = setTimeout(() => {
      this.cursorTimer = null;
      this.sendCursor();
    }, wait);
  }

  selection(ids: readonly string[]): void {
    if (this.stopped || !this.socket?.connected) return;
    const signature = ids.join(",");
    if (signature === this.lastSelection) return;
    this.lastSelection = signature;
    this.socket.emit(protocol.client.selection, { ids: [...ids] });
  }

  /**
   * Shows a peer out of the room. The server checks the role again; this guard
   * only keeps a viewer from producing traffic that would be refused.
   */
  remove(peerId: string): void {
    if (this.stopped || !this.socket?.connected || this.role !== "owner") return;
    if (!peerId) return;
    this.socket.emit(protocol.client.remove, { id: peerId });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;

    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.cursorTimer = null;
    this.pendingCursor = undefined;
    this.socket?.disconnect();
    this.socket = null;
    this.local.destroy();
    this.remote.destroy();
  }

  // ---------------------------------------------------------------- internals

  private sendCursor(): void {
    const point = this.pendingCursor;
    this.pendingCursor = undefined;
    this.lastCursorAt = Date.now();
    this.socket?.emit(protocol.client.cursor, point ?? { x: null, y: null });
  }

  private async getToken(): Promise<string> {
    const fresh =
      this.token && this.token.expiresAt - Date.now() > protocol.limits.tokenRefreshMs;
    if (fresh) return this.token!.value;

    const result = await fetchCollabToken({
      id: this.options.boardId,
      shareToken: this.options.shareToken,
      guestId: this.options.guestId,
    });
    this.token = { value: result.token, expiresAt: result.expiresAt };
    this.role = result.role;
    return result.token;
  }

  private async credentials(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return { token, guestId: this.options.guestId };
  }

  /** Replaces the shared map with the scene, touching only what changed. */
  private writeScene(elements: readonly Element[]): void {
    const seen = new Set<string>();
    let touched = false;

    this.local.transact(() => {
      for (const element of elements) {
        seen.add(element.id);
        const current = this.map.get(element.id);
        if (
          !current ||
          current.updatedAt !== element.updatedAt ||
          current.version !== element.version
        ) {
          this.map.set(element.id, element);
          touched = true;
        }
      }

      for (const id of [...this.map.keys()]) {
        if (seen.has(id)) continue;
        this.map.delete(id);
        touched = true;
      }
    });

    if (touched) this.known = this.readMap();
  }

  private readMap(): Map<string, Element> {
    const next = new Map<string, Element>();
    for (const [id, element] of this.map) next.set(id, element);
    return next;
  }

  /** Sends everything `local` knows that `remote` has not seen. */
  private flush(): void {
    if (!this.socket?.connected || this.role === "viewer") return;
    const update = Y.encodeStateAsUpdate(this.local, Y.encodeStateVector(this.remote));
    // An empty update still encodes to two bytes; anything longer is a change.
    if (update.length <= 2) return;
    Y.applyUpdate(this.remote, update);
    this.socket.emit(protocol.client.update, { update: toBase64(update) });
  }

  private receive(encoded: string): void {
    let update: Uint8Array;
    try {
      update = fromBase64(encoded);
    } catch {
      return;
    }

    Y.applyUpdate(this.remote, update);
    Y.applyUpdate(this.local, update, "remote");

    // Yjs resolves concurrent writes by client id, not by `updatedAt`. A shape
    // drawn during a tunnel can therefore lose to an older room copy simply
    // because the other client wrote later in CRDT time. Put the newer scene
    // copy back before reporting, so the room converges on what was drawn, and
    // send that correction out instead of silently accepting the older shape.
    //
    // A viewer never corrects the room: it has no authority to write, and its
    // snapshot is only what it was given.
    let restored = false;
    if (this.role !== "viewer") {
      const scene = new Map(this.options.getElements().map((element) => [element.id, element]));
      this.local.transact(() => {
        for (const [id, element] of this.map) {
          const local = scene.get(id);
          if (local && local.updatedAt > element.updatedAt) {
            this.map.set(id, local);
            restored = true;
          }
        }
      });
    }

    const next = this.readMap();
    const changed: Element[] = [];
    const removed: string[] = [];

    for (const [id, element] of next) {
      const previous = this.known.get(id);
      if (
        !previous ||
        previous.updatedAt !== element.updatedAt ||
        previous.version !== element.version
      ) {
        changed.push(element);
      }
    }
    for (const id of this.known.keys()) {
      if (!next.has(id)) removed.push(id);
    }

    this.known = next;
    if (changed.length > 0 || removed.length > 0) {
      this.options.onRemote(changed, removed);
    }
    if (restored) this.flush();
  }
}
