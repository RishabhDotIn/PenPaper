import postgres from "postgres";
import { Consumer, stringDeserializers } from "@platformatic/kafka";
import {
  brokerList,
  ensureTopic,
  eventsEnabled,
  eventsTopic,
  validateBoardEvent,
} from "./events.mjs";
import { BOARD_EVENTS_DDL, BOARD_EVENTS_INDEXES } from "./schema.mjs";

/**
 * The event writer.
 *
 * A second process on purpose. Consuming is a loop that owns a connection and
 * an offset; putting it beside the request handler would mean a slow insert
 * holding a page, and one process that restarts for both reasons at once. This
 * one only does two things: read a topic, write rows.
 *
 * It is idempotent. Kafka delivers at least once, so the table's primary key is
 * the event id and every insert says `on conflict (id) do nothing` — a
 * redelivered message is a no-op, not a duplicate in someone's activity line.
 */

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!eventsEnabled()) {
  console.warn("PenPaper worker: KAFKA_BROKERS is not set, so there is nothing to consume.");
  process.exit(0);
}

if (!databaseUrl) {
  console.error("PenPaper worker: DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 2, idle_timeout: 20, prepare: false });

await sql.unsafe(BOARD_EVENTS_DDL);
for (const statement of BOARD_EVENTS_INDEXES) await sql.unsafe(statement);

const ready = await ensureTopic();
if (!ready) {
  console.warn("PenPaper worker: the topic is not ready yet; consuming may wait.");
}

const consumer = new Consumer({
  groupId: "penpaper-events",
  clientId: "penpaper-worker",
  bootstrapBrokers: brokerList(),
  deserializers: stringDeserializers,
  sessionTimeout: 30_000,
  heartbeatInterval: 1_000,
  maxWaitTime: 1_000,
});

let handled = 0;
let rejected = 0;

/** @type {Awaited<ReturnType<typeof consumer.consume>> | null} */
let stream = null;

async function start() {
  stream = await consumer.consume({ topics: [eventsTopic()], autocommit: true });

  for await (const message of stream) {
    const event = parse(message.value);
    if (!event) {
      rejected += 1;
      console.warn("PenPaper worker: dropped an event that did not validate");
      continue;
    }

    try {
      await sql`
        insert into pp_board_events
          (id, board_id, type, actor_id, actor_name, role, detail, created_at)
        values
          (${event.id}, ${event.boardId}, ${event.type}, ${event.actorId},
           ${event.actorName}, ${event.role}, ${event.detail}, ${event.at})
        on conflict (id) do nothing
      `;
      handled += 1;
    } catch (error) {
      // A row that cannot be written is logged with the event id and skipped:
      // retrying forever would wedge every other board's activity behind it.
      console.error(
        "PenPaper worker: insert failed",
        event.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function parse(value) {
  if (typeof value !== "string") return null;
  try {
    return validateBoardEvent(JSON.parse(value));
  } catch {
    return null;
  }
}

const shutdown = async (signal) => {
  console.log(`PenPaper worker: ${signal}, stopping after ${handled} events`);
  await stream?.close().catch(() => {});
  await consumer.close().catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log(
  `PenPaper worker: consuming ${eventsTopic()} as "penpaper-events" from ${brokerList().join(", ")}`,
);

start().catch((error) => {
  console.error("PenPaper worker: stopped", error);
  process.exit(1);
});
