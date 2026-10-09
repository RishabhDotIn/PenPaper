import { SCENE_VERSION } from "@penpaper/engine";
import { mergeChanges, mergeElements } from "@/lib/drive/document";
import type { Element } from "@penpaper/shared";
import { defaultTitle, loadBoard, loadMeta, saveBoard } from "@/lib/storage";
import { accountUser } from "./account";
import {
  ApiError,
  createServerBoard,
  fetchServerBoard,
  listServerBoards,
  saveServerBoard,
  type BoardSummary,
  type Role,
} from "./api";

/**
 * Durable sync for an account whose notepads live on the server.
 *
 * The socket is for the seconds a stroke is being drawn; this is for the
 * minute after, and for the phone that was closed mid-sentence. Each save is a
 * whole snapshot rather than a delta, because Postgres already holds the
 * materialised scene and a snapshot is what every reader can consume without a
 * replay.
 *
 * A local board is the source of truth while it is open. The server is merged
 * into it on open and receives a debounced copy afterwards, exactly like Drive.
 */

/** Long enough to coalesce a burst of strokes, short enough to be cheap. */
const PUSH_DEBOUNCE_MS = 2_500;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const shareTokens = new Map<string, string | null>();

export function rememberShareToken(boardId: string, token: string | null): void {
  shareTokens.set(boardId, token);
}

export function shareTokenFor(boardId: string): string | null {
  return shareTokens.get(boardId) ?? null;
}

export interface PulledBoard {
  elements: Element[];
  role: Role;
  title: string;
}

/**
 * Reads the server copy, or null when this caller may not see it.
 *
 * A network failure is not "not found": the caller must keep the local board
 * rather than treat it as deleted.
 */
export async function pullServerBoard(
  boardId: string,
  shareToken: string | null = null,
): Promise<PulledBoard | null> {
  if (!shareToken && !accountUser()) return null;

  const found = await fetchServerBoard(boardId, shareToken);
  if (!found) return null;

  return {
    elements: found.board.content.elements ?? [],
    role: found.role,
    title: found.board.title,
  };
}

/**
 * Merges the server's scene into a local one, last writer wins per element.
 *
 * Returns the merged array whether or not it changed, so a first open on a new
 * device can adopt content it has never seen and an offline device can keep the
 * edits it made after its last upload.
 */
export function mergeServerElements(
  local: readonly Element[],
  remote: readonly Element[],
): { elements: Element[]; changed: boolean } {
  const elements = mergeElements(local, remote);
  return { elements, changed: mergeChanges(local, elements) };
}

/**
 * Registers a local notepad on the server the first time its owner opens it.
 *
 * The id is kept, so the URL and every share link already made for it stay
 * valid. `createServerBoard` is idempotent on the server, which makes two tabs
 * opening the same notepad at once harmless.
 */
export async function ensureServerBoard(input: {
  boardId: string;
  title: string;
  elements: Element[];
}): Promise<Role | null> {
  if (!accountUser()) return null;

  try {
    await createServerBoard({
      id: input.boardId,
      title: input.title,
      content: { version: SCENE_VERSION, elements: input.elements },
    });
    return "owner";
  } catch (error) {
    // Another tab opening the same notepad is harmless: createBoard returns the
    // existing row for its owner. A 409 therefore means a different account
    // already uses this id, and this device must not pretend to own it.
    if (error instanceof ApiError && error.status === 409) return null;
    throw error;
  }
}

/** Uploads the device's current snapshot once. */
export async function pushServerBoard(
  boardId: string,
  shareToken: string | null = shareTokenFor(boardId),
): Promise<boolean> {
  if (!shareToken && !accountUser()) return false;

  const [snapshot, meta] = await Promise.all([loadBoard(boardId), loadMeta(boardId)]);
  if (!snapshot) return false;

  try {
    await saveServerBoard({
      id: boardId,
      shareToken,
      title: meta?.title ?? defaultTitle(boardId),
      content: { version: SCENE_VERSION, elements: snapshot.elements },
    });
    return true;
  } catch (error) {
    // A viewer link cannot write, and a revoked link must not retry forever.
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return false;
    throw error;
  }
}

/**
 * Queues one upload per board.
 *
 * Reading the snapshot at fire time, not at queue time, means the last stroke
 * of a burst is included without keeping a second copy of the scene in memory.
 */
export function queueServerSync(
  boardId: string,
  shareToken: string | null = shareTokenFor(boardId),
): void {
  if (!shareToken && !accountUser()) return;

  shareTokens.set(boardId, shareToken);

  const running = timers.get(boardId);
  if (running) clearTimeout(running);

  timers.set(
    boardId,
    setTimeout(() => {
      timers.delete(boardId);
      void pushServerBoard(boardId, shareToken).catch((error: unknown) => {
        console.warn("PenPaper: could not save the notepad to your account", error);
      });
    }, PUSH_DEBOUNCE_MS),
  );
}

/** Runs every queued upload now; used by `pagehide`. */
export async function flushServerSync(): Promise<void> {
  const pending = [...timers.keys()];
  for (const boardId of pending) {
    const timer = timers.get(boardId);
    if (timer) clearTimeout(timer);
    timers.delete(boardId);
  }

  await Promise.all(
    pending.map((boardId) =>
      pushServerBoard(boardId).catch((error: unknown) => {
        console.warn("PenPaper: could not flush the notepad to your account", error);
      }),
    ),
  );
}

/** The account's notepads that live on the server, for the library list. */
export async function listServerLibrary(): Promise<BoardSummary[]> {
  if (!accountUser()) return [];
  try {
    const { boards } = await listServerBoards();
    return boards;
  } catch {
    return [];
  }
}

/** Writes a merged scene back to IndexedDB without disturbing the camera. */
export async function adoptMergedElements(
  boardId: string,
  elements: Element[],
  camera: { x: number; y: number; zoom: number },
): Promise<void> {
  await saveBoard(boardId, {
    version: SCENE_VERSION,
    elements,
    camera,
    savedAt: Date.now(),
  });
}
