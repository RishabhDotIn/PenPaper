import { randomUUID } from "node:crypto";
import { Admin, Producer, stringSerializers } from "@platformatic/kafka";

/**
 * Board events, produced here and read by `worker.mjs`.
 *
 * An event is a fact about a board that happened once: it was created, someone
 * saved it, a link was minted, the host removed a guest. It is deliberately not
 * a copy of the drawing. The drawing has its own path (IndexedDB, Postgres, the
 * room); this log answers "what has happened here lately", which no snapshot
 * can.
 *
 * With `KAFKA_BROKERS` unset every function here is a no-op, so a deployment
 * without a broker behaves exactly as it did before this file existed.
 *
 * Configuration is read when a function is called, not at import. This module
 * is loaded by the process that boots Next as well as by the worker, and a
 * value captured at import time can be captured before the environment exists.
 */

/** The brokers this process should publish to, if any. */
export function brokerList() {
  return (process.env.KAFKA_BROKERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** True when this process has a broker to publish to. */
export function eventsEnabled() {
  return brokerList().length > 0;
}

/** The topic every writer and the single reader agree on. */
export function eventsTopic() {
  return process.env.KAFKA_TOPIC?.trim() || "pp.board.events";
}

const TYPES = new Set([
  "board.created",
  "board.saved",
  "share.minted",
  "share.revoked",
  "board.deleted",
  "room.opened",
  "member.removed",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

const ROLES = new Set(["owner", "editor", "viewer"]);

/**
 * @typedef {object} BoardEvent
 * @property {string} id
 * @property {string} type
 * @property {string} boardId
 * @property {string | null} actorId
 * @property {string} actorName
 * @property {string | null} role
 * @property {string | null} detail
 * @property {string} at
 */

/** Collapses whitespace, strips control characters, and bounds the length. */
function clean(value, fallback, max) {
  if (typeof value !== "string") return fallback;
  const text = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return text.length > 0 ? text : fallback;
}

/**
 * The one validator.
 *
 * The producer runs it before publishing and the worker runs it after
 * consuming, because a broker is an outside system: anything on the topic is
 * untrusted input, including messages some other tool wrote. A rejected event
 * is dropped, never repaired into something plausible.
 *
 * @param {unknown} raw
 * @returns {BoardEvent | null}
 */
export function validateBoardEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const value = /** @type {Record<string, unknown>} */ (raw);

  if (typeof value.id !== "string" || !UUID.test(value.id)) return null;
  if (typeof value.type !== "string" || !TYPES.has(value.type)) return null;
  if (typeof value.boardId !== "string" || !BOARD_ID.test(value.boardId)) return null;

  const actorId =
    typeof value.actorId === "string" && UUID.test(value.actorId) ? value.actorId : null;
  const role = typeof value.role === "string" && ROLES.has(value.role) ? value.role : null;

  const parsed = typeof value.at === "string" ? Date.parse(value.at) : Number.NaN;

  return {
    id: value.id,
    type: value.type,
    boardId: value.boardId,
    actorId,
    actorName: clean(value.actorName, "Someone", 60),
    role,
    detail: clean(value.detail, "", 160) || null,
    at: Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString(),
  };
}

/** @type {{ producer: Producer | null }} */
// Next bundles each route handler on its own, so a module-level variable is not
// one per process: two routes that both publish would otherwise open two
// producers, and a hot reload would leave the old one running. The holder lives
// on globalThis so every copy in this process shares one connection.
const holder = /** @type {{ producer: Producer | null }} */ (
  (globalThis.__penpaperEvents ??= { producer: null })
);

function client() {
  holder.producer ??= new Producer({
    clientId: "penpaper-web",
    bootstrapBrokers: brokerList(),
    serializers: stringSerializers,
  });
  return holder.producer;
}

/** @type {BoardEvent[]} */
const queue = [];
let writing = Promise.resolve();

/**
 * Sends whatever is queued, one batch at a time.
 *
 * Publishing must never slow a save down, so the route hands the event over and
 * returns: a broker that is slow or down costs the request nothing. The queue
 * is bounded, and the oldest event is dropped when it is full, because a stale
 * activity line is worth less than a request that finishes.
 */
function drain() {
  writing = writing
    .then(async () => {
      while (queue.length > 0) {
        const batch = queue.splice(0, 50);
        try {
          await client().send({
            messages: batch.map((event) => ({
              topic: eventsTopic(),
              key: event.boardId,
              value: JSON.stringify(event),
            })),
          });
        } catch (error) {
          console.warn(
            "PenPaper: could not publish board events",
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    })
    .catch(() => {});

  return writing;
}

/**
 * Records one board event.
 *
 * @param {Partial<BoardEvent> & { type: string, boardId: string }} input
 */
export function emitBoardEvent(input) {
  if (!eventsEnabled()) return;

  const event = validateBoardEvent({
    id: randomUUID(),
    at: new Date().toISOString(),
    ...input,
  });
  if (!event) return;

  if (queue.length >= 1_000) queue.shift();
  queue.push(event);
  void drain();
}

/** Waits for the queue to empty, bounded so shutdown cannot hang. */
export async function flushEvents(timeoutMs = 5_000) {
  if (!eventsEnabled()) return;
  await Promise.race([drain(), new Promise((resolve) => setTimeout(resolve, timeoutMs).unref())]);
}

/** Creates the topic if it is not there yet. Used by the worker. */
export async function ensureTopic() {
  if (!eventsEnabled()) return false;

  const admin = new Admin({ clientId: "penpaper-admin", bootstrapBrokers: brokerList() });
  try {
    await admin.createTopics({ topics: [eventsTopic()], partitions: 3, replicas: 1 });
    return true;
  } catch (error) {
    // An existing topic is the expected result after the first start.
    const message = error instanceof Error ? error.message : String(error);
    if (/exist/i.test(message)) return true;
    console.warn("PenPaper: could not create the events topic", message);
    return false;
  } finally {
    await admin.close().catch(() => {});
  }
}

/** Flushes and closes the producer. */
export async function closeEvents() {
  await flushEvents();
  const current = holder.producer;
  holder.producer = null;
  await current?.close().catch(() => {});
}
