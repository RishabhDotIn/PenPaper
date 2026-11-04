import { Redis } from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";

/**
 * What the room service needs from Redis, and nothing else.
 *
 * Two jobs, one connection each:
 *
 *  - the Socket.IO adapter, so a broadcast reaches every instance instead of
 *    only the one that owns the socket that sent it;
 *  - an append-only log per room, so an instance that opens a room it has never
 *    seen can rebuild the same document from what other instances already
 *    wrote. Without the log the adapter would happily deliver strokes to peers
 *    whose server had never heard of the drawing, and the first `sync-request`
 *    would answer with an empty canvas.
 *
 * The adapter needs a publishing connection and a subscribing one, and the log
 * needs a fourth: a blocked XREAD owns its connection until it returns, so the
 * tail of every open room cannot share one with the appends it is reading.
 *
 * With `REDIS_URL` unset, `attachSharedRooms` returns null and the room service
 * keeps its original single-process behaviour.
 */

const ROOM_TTL_MS = 10 * 60_000;
const STREAM_MAXLEN = 5_000;

/**
 * Connects the adapter and returns the streams client, or null.
 *
 * The URL is read here rather than at import: this module is imported by the
 * process that boots Next, and a value read before the environment is loaded
 * would silently disable sharing.
 *
 * The adapter is attached only after a probe answers. A dead URL must leave the
 * rooms exactly as they are without Redis, not install a publish path whose
 * rejections nobody awaits.
 *
 * The returned `close` matters for tests and for two instances in one terminal:
 * a leaked subscription keeps the process alive forever.
 *
 * @param {import("socket.io").Server} io
 */
export async function attachSharedRooms(io) {
  const address = process.env.REDIS_URL?.trim();
  if (!address) return null;

  const probe = new Redis(address, {
    lazyConnect: true,
    connectTimeout: 3_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  // The connect failure is reported once by the catch below, not per retry.
  probe.on("error", () => {});
  try {
    await probe.connect();
    await probe.ping();
  } catch (error) {
    console.warn(
      "PenPaper: Redis is unreachable, so rooms stay single-process",
      error instanceof Error ? error.message : String(error),
    );
    probe.disconnect();
    return null;
  }
  probe.disconnect();

  // Broadcasts queue while a running Redis is away and are sent when it comes
  // back. Rejecting them here would be an unhandled promise: the adapter does
  // not await its publish.
  const options = { maxRetriesPerRequest: null, connectTimeout: 3_000 };
  const pub = new Redis(address, options);
  const sub = pub.duplicate();
  // Commands: appends, replays and the stream's own bookkeeping. Every call is
  // wrapped, so a bounded retry is the right failure mode here.
  const log = new Redis(address, { maxRetriesPerRequest: 1, connectTimeout: 3_000 });
  // Blocking reads only, on their own connection. A blocked XREAD holds the
  // whole connection, so sharing it with writes would park every append behind
  // the tail loop for as long as the block lasts.
  const watch = new Redis(address, options);

  for (const [name, connection] of [
    ["pub", pub],
    ["sub", sub],
    ["log", log],
    ["tail", watch],
  ]) {
    connection.on("error", (error) => {
      console.warn(`PenPaper: room Redis ${name} error`, error.message);
    });
  }

  io.adapter(createAdapter(pub, sub));

  return {
    async read(roomId) {
      try {
        const entries = await log.xrange(key(roomId), "-", "+");
        return entries.map(([id, fields]) => ({ id, payload: field(fields) })).filter((e) => e.payload !== null);
      } catch (error) {
        warn(error);
        return [];
      }
    },

    async append(roomId, payload) {
      try {
        await log
          .multi()
          .xadd(key(roomId), "MAXLEN", "~", STREAM_MAXLEN, "*", "d", payload)
          .pexpire(key(roomId), ROOM_TTL_MS)
          .exec();
      } catch (error) {
        warn(error);
      }
    },

    /**
     * Applies every entry after `afterId`, then keeps applying new ones.
     *
     * Returns a stop function. Duplicates are harmless: a Yjs update applied
     * twice is the same document.
     */
    tail(roomId, afterId, onPayload) {
      let stopped = false;
      const key_ = key(roomId);
      let id = afterId || "0-0";

      const loop = (async () => {
        while (!stopped) {
          let batch;
          try {
            batch = await watch.xread("BLOCK", 1_000, "COUNT", 200, "STREAMS", key_, id);
          } catch (error) {
            if (stopped) return;
            warn(error);
            await pause(500);
            continue;
          }
          if (!batch) continue;

          for (const [, entries] of batch) {
            for (const [entryId, fields] of entries) {
              id = entryId;
              const payload = field(fields);
              if (payload) onPayload(payload);
            }
          }
        }
      })();

      return () => {
        stopped = true;
        // A blocked XREAD ignores `stopped` until it returns, so the loop is
        // woken with a harmless entry instead of waiting up to a second per
        // closed room.
        void log.xadd(key_, "*", "d", "").catch(() => {});
        void loop.catch(() => {});
      };
    },

    async drop(roomId) {
      try {
        await log.del(key(roomId));
      } catch (error) {
        warn(error);
      }
    },

    async close() {
      await Promise.allSettled([pub.quit(), sub.quit(), log.quit(), watch.quit()]);
    },
  };
}

function key(roomId) {
  return `pp:room:${roomId}`;
}

/** ioredis flattens field/value pairs into one array. */
function field(fields) {
  const index = fields.indexOf("d");
  return index >= 0 ? fields[index + 1] ?? null : null;
}

function warn(error) {
  console.warn("PenPaper: room log unavailable", error instanceof Error ? error.message : String(error));
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
