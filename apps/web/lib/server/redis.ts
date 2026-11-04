import { Redis } from "ioredis";

/**
 * Redis, when the deployment has one.
 *
 * Nothing here is required. With `REDIS_URL` unset the app falls back to the
 * per-process behaviours it had before: a fixed-window counter, a Postgres
 * session lookup, and a local guard against repeated save events. That is
 * deliberate — the free Render service has no Redis, and a missing cache must
 * never be the reason a board fails to open.
 *
 * When it is set, Redis provides three things a single process cannot: one
 * shared rate-limit window, a session cache every route reads through, and the
 * once-guard that keeps a burst of autosaves to one line of activity.
 */

const url = process.env.REDIS_URL?.trim();

/** True when a Redis was configured for this process. */
export const redisConfigured = Boolean(url);

let downUntil = 0;
let reportedFailure = false;

/**
 * The shared connection, kept on globalThis.
 *
 * Next compiles each route handler separately, so a module-scoped client would
 * become one connection per route. The app only needs one, and a hot reload
 * should hand the next request the same socket.
 */
const holder = ((globalThis as { __penpaperRedis?: { client: Redis | null } }).__penpaperRedis ??= {
  client: null,
});

function connection(): Redis {
  if (holder.client) return holder.client;

  const created = new Redis(url!, {
    // The first command opens the connection, so a process that never uses
    // Redis never pays for a socket to it.
    lazyConnect: true,
    connectTimeout: 2_000,
    commandTimeout: 1_500,
    // One retry, not the default twenty: a request should fall back to
    // Postgres in milliseconds rather than queue behind a dead cache.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  });

  // One listener per process, attached when the client is built: attaching it
  // on every call would add one per request.
  created.on("error", (error: Error) => {
    if (reportedFailure) return;
    reportedFailure = true;
    console.warn(
      "PenPaper: Redis is unreachable, falling back to in-process state",
      error.message,
    );
  });

  holder.client = created;
  return created;
}

/**
 * A ready client, or null.
 *
 * After a failure the client is skipped for five seconds, so a Redis that is
 * down costs one timeout instead of one per request.
 */
async function ready(): Promise<Redis | null> {
  if (!url || Date.now() < downUntil) return null;

  const redis = connection();
  // The status changes asynchronously inside `connect()`, so it is read through
  // a function: a direct comparison would be narrowed once and never re-read.
  const state = (): string => redis.status;

  if (state() === "ready") return redis;

  try {
    if (state() === "wait" || state() === "end" || state() === "close") await redis.connect();
  } catch {
    downUntil = Date.now() + 5_000;
    return null;
  }

  if (state() !== "ready") {
    downUntil = Date.now() + 5_000;
    return null;
  }
  return redis;
}

function failed(error: unknown): null {
  downUntil = Date.now() + 5_000;
  if (!reportedFailure) {
    reportedFailure = true;
    console.warn("PenPaper: Redis command failed, falling back", describe(error));
  }
  return null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A sliding window, in Lua so the read and the write cannot interleave.
 *
 * The fixed window this replaces could let a client spend the whole quota at
 * the end of one minute and again at the start of the next; a sorted set of
 * timestamps has no such seam, and every instance sees the same set.
 *
 * Returns true when the request is allowed.
 */
const SLIDING_WINDOW = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
if redis.call('ZCARD', key) >= limit then
  redis.call('PEXPIRE', key, window)
  return 0
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return 1
`;

/**
 * Counts one attempt against `key`, allowing `limit` per window.
 *
 * Returns null when Redis is not available, which the caller treats as "use
 * the in-process counter" rather than "allow everything".
 */
export async function redisAllow(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean | null> {
  const redis = await ready();
  if (!redis) return null;

  try {
    const result = await redis.eval(
      SLIDING_WINDOW,
      1,
      `pp:limit:${key}`,
      Date.now().toString(),
      windowMs.toString(),
      limit.toString(),
      `${Date.now()}-${Math.random()}`,
    );
    return result === 1;
  } catch (error) {
    return failed(error);
  }
}
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = await ready();
  if (!redis) return null;

  try {
    const raw = await redis.get(`pp:cache:${key}`);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    return failed(error);
  }
}

export async function cacheSet(key: string, value: unknown, ttlMs: number): Promise<void> {
  const redis = await ready();
  if (!redis) return;

  try {
    await redis.set(`pp:cache:${key}`, JSON.stringify(value), "PX", Math.max(1, Math.round(ttlMs)));
  } catch (error) {
    failed(error);
  }
}

export async function cacheDel(key: string): Promise<void> {
  const redis = await ready();
  if (!redis) return;

  try {
    await redis.del(`pp:cache:${key}`);
  } catch (error) {
    failed(error);
  }
}

/**
 * True the first time `key` is seen inside its window.
 *
 * Used to fold a burst of autosaves into one event: the board writes every
 * 1.5 seconds while someone draws, and the event log should say "someone is
 * working on this", not replay the strokes.
 */
export async function redisOnce(key: string, ttlMs: number): Promise<boolean | null> {
  const redis = await ready();
  if (!redis) return null;

  try {
    const result = await redis.set(`pp:once:${key}`, "1", "PX", Math.round(ttlMs), "NX");
    return result === "OK";
  } catch (error) {
    return failed(error);
  }
}

