import { SCENE_VERSION } from "@penpaper/engine";
import type { RemoteBoard } from "@/lib/drive/api";
import { createDemoElements } from "@/lib/demo-board";
import {
  defaultTitle,
  loadMeta,
  listBoards,
  saveBoard,
  type BoardMeta,
} from "@/lib/storage";

/**
 * One card on the shelf.
 *
 * `source` is the honest part: a board can be local only, in Drive only (this
 * device has never opened it, so it has no scene yet), or both. Remote-only
 * boards still open — `BoardLoader` fetches them by id.
 */
export interface ShelfItem {
  id: string;
  title: string;
  updatedAt: number;
  /** Live elements on this device, or -1 when the board has never been opened here. */
  elementCount: number;
  source: "local" | "remote" | "both";
  driveFileId?: string;
  inLibrary: boolean;
  syncedAt?: number;
}

export function buildShelf(
  local: readonly BoardMeta[],
  remote: readonly RemoteBoard[],
): ShelfItem[] {
  const remoteById = new Map(remote.map((board) => [board.boardId, board]));
  const items: ShelfItem[] = [];

  for (const meta of local) {
    const board = remoteById.get(meta.id);
    remoteById.delete(meta.id);
    items.push({
      id: meta.id,
      title: board?.title || meta.title,
      // Two clocks: the device's and Drive's. The newer of the two is what the
      // person means by "last edited", and it keeps the order stable when one
      // device's clock runs ahead.
      updatedAt: Math.max(meta.updatedAt, board ? Date.parse(board.modifiedTime) || 0 : 0),
      elementCount: meta.elementCount,
      source: board ? "both" : "local",
      driveFileId: board?.fileId ?? meta.driveFileId,
      inLibrary: Boolean(board || meta.driveFileId || meta.inLibrary),
      syncedAt: meta.syncedAt,
    });
  }

  for (const board of remoteById.values()) {
    items.push({
      id: board.boardId,
      title: board.title,
      updatedAt: Date.parse(board.modifiedTime) || 0,
      elementCount: -1,
      source: "remote",
      driveFileId: board.fileId,
      inLibrary: true,
    });
  }

  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

const DEMO_FLAG = "penpaper:demo-seeded:v1";

/**
 * A brand-new install should not open on an empty shelf.
 *
 * The demo is written once, like any other board, so it can be edited, renamed,
 * and deleted; the flag only exists so deleting it does not resurrect it on the
 * next visit. Failures are silent: a private-mode browser still gets a working
 * shelf, just without the example.
 */
export async function seedDemoBoard(): Promise<void> {
  try {
    if (localStorage.getItem(DEMO_FLAG)) return;

    const existing = await loadMeta("demo");
    if (!existing) {
      await saveBoard("demo", {
        version: SCENE_VERSION,
        elements: createDemoElements(),
        // Identity is the "the user has not moved the view" sentinel; the board
        // loader centres the demo the first time it opens.
        camera: { x: 0, y: 0, zoom: 1 },
        savedAt: Date.now(),
      });
    }

    localStorage.setItem(DEMO_FLAG, "1");
  } catch {
    // Storage is unavailable; the shelf will simply be empty.
  }
}

export async function loadShelf(): Promise<{ local: BoardMeta[]; items: ShelfItem[] }> {
  await seedDemoBoard();
  const local = await listBoards();
  return { local, items: buildShelf(local, []) };
}

export function newBoardId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `nb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** "just now", "4m", "3h", "yesterday", "12 Mar". */
export function formatAgo(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "not synced yet";

  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 172_800) return "yesterday";
  if (seconds < 604_800) return `${Math.round(seconds / 86_400)} days ago`;

  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function describeCount(elementCount: number): string {
  if (elementCount < 0) return "In Drive";
  if (elementCount === 0) return "Empty";
  return `${elementCount} ${elementCount === 1 ? "shape" : "shapes"}`;
}

export { defaultTitle };
