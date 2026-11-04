import { emitBoardEvent } from "../../server/events.mjs";
import { redisOnce } from "./redis";

/**
 * Route-side rules about which events are worth writing.
 *
 * `events.mjs` owns the producer and the shape; this file owns the judgement
 * that belongs to the API — who counts as the actor, and how often a stream of
 * autosaves becomes one line of activity.
 */

export { emitBoardEvent };

export interface EventActor {
  actorId: string | null;
  actorName: string;
  role: string | null;
}

const SAVE_EVENT_WINDOW_MS = 60_000;

/** Fallback window for a deployment with no Redis. Bounded, like the limiter. */
const recentlySaved = new Map<string, number>();

/**
 * One "saved" event per board per minute.
 *
 * A board saves every 1.5 seconds while someone draws. Publishing each one
 * would put thousands of identical rows in the log and make the activity line
 * useless, so the first save after a quiet minute is the one that is recorded.
 */
export async function emitBoardSaved(boardId: string, actor: EventActor): Promise<void> {
  const first = await redisOnce(`save:${boardId}`, SAVE_EVENT_WINDOW_MS);

  if (first === null) {
    const now = Date.now();
    const last = recentlySaved.get(boardId) ?? 0;
    if (now - last < SAVE_EVENT_WINDOW_MS) return;
    recentlySaved.set(boardId, now);
    if (recentlySaved.size > 5_000) {
      for (const [key, at] of recentlySaved) {
        if (now - at >= SAVE_EVENT_WINDOW_MS) recentlySaved.delete(key);
      }
    }
  } else if (!first) {
    return;
  }

  emitBoardEvent({ type: "board.saved", boardId, ...actor });
}
