import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { SCENE_VERSION, type Camera, type SceneSnapshot } from "@penpaper/engine";
import type { Element } from "@penpaper/shared";

/**
 * What lives on the device for one board.
 *
 * The element array is the same payload the collab service will send over the
 * wire; `camera` is device-local view state that makes reopening feel like
 * resuming rather than starting over.
 */
export interface BoardSnapshot extends SceneSnapshot {
  camera: Camera;
  savedAt: number;
}

/**
 * The shelf card, kept next to the board rather than inside it.
 *
 * Listing boards used to mean reading every scene, which is the whole board —
 * megabytes of elements to render a list of titles. Metadata lives in its own
 * store so `listBoards()` reads only what the library shows. Drive bookkeeping
 * is here too: it describes *this device's* relationship to a remote copy, and
 * writing it into the board document would make two devices fight over it.
 */
export interface BoardMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Live elements, matching what the canvas would draw. */
  elementCount: number;
  /** Drive file id once this board belongs to the account's library. */
  driveFileId?: string;
  /** Remote revision this device last agreed with. */
  driveVersion?: string;
  /** Epoch ms of the last successful push or pull. */
  syncedAt?: number;
  /**
   * Chosen for Drive while auto-sync is off. Auto-sync ignores it: when the
   * switch is on, the whole shelf travels.
   */
  inLibrary?: boolean;
}

interface PenPaperDB extends DBSchema {
  boards: {
    key: string;
    value: BoardSnapshot;
  };
  meta: {
    key: string;
    value: BoardMeta;
  };
}

const DB_NAME = "penpaper";
/**
 * v2 adds the `meta` store. IndexedDB runs the upgrade before any read, so an
 * older database keeps its boards and gains a shelf lazily: `listBoards()`
 * backfills a card for every scene it finds without one.
 */
const DB_VERSION = 2;
const BOARD_STORE = "boards";
const META_STORE = "meta";

export const TITLE_MAX = 80;

let handle: Promise<IDBPDatabase<PenPaperDB>> | null = null;

function getDb(): Promise<IDBPDatabase<PenPaperDB>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("PenPaper: IndexedDB is not available"));
  }

  // One connection for the whole tab: opening per save would serialise writes
  // behind a fresh upgrade check on every autosave tick.
  handle ??= openDB<PenPaperDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(BOARD_STORE)) db.createObjectStore(BOARD_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    },
  });

  return handle;
}

/** What a board is called before anyone renames it. */
export function defaultTitle(id: string): string {
  return id === "demo" ? "PenPaper demo" : "Untitled notepad";
}

export function cleanTitle(raw: string, fallback: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
  return trimmed.length > 0 ? trimmed : fallback;
}

function liveCount(elements: readonly Element[]): number {
  let count = 0;
  for (const element of elements) if (!element.isDeleted) count += 1;
  return count;
}

function metaFor(id: string, snapshot: BoardSnapshot): BoardMeta {
  return {
    id,
    title: defaultTitle(id),
    createdAt: snapshot.savedAt,
    updatedAt: snapshot.savedAt,
    elementCount: liveCount(snapshot.elements),
  };
}

export async function saveBoard(id: string, snapshot: BoardSnapshot): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([BOARD_STORE, META_STORE], "readwrite");
  const metaStore = tx.objectStore(META_STORE);
  const existing = await metaStore.get(id);

  // Content changes; the Drive relationship does not. Spreading the existing
  // record keeps file ids and the last agreed revision across an autosave.
  const meta: BoardMeta = {
    ...(existing ?? metaFor(id, snapshot)),
    id,
    updatedAt: snapshot.savedAt,
    elementCount: liveCount(snapshot.elements),
  };

  await tx.objectStore(BOARD_STORE).put(snapshot, id);
  await metaStore.put(meta, id);
  await tx.done;
}

export async function loadBoard(id: string): Promise<BoardSnapshot | null> {
  const db = await getDb();
  return (await db.get(BOARD_STORE, id)) ?? null;
}

export async function loadMeta(id: string): Promise<BoardMeta | null> {
  const db = await getDb();
  return (await db.get(META_STORE, id)) ?? null;
}

export async function listBoards(): Promise<BoardMeta[]> {
  const db = await getDb();
  const ids = await db.getAllKeys(BOARD_STORE);
  const stored = await db.getAll(META_STORE);

  const known = new Set(ids);
  const byId = new Map(stored.filter((meta) => known.has(meta.id)).map((meta) => [meta.id, meta]));

  // Boards written before v2 (or by an older build) have no card yet. Build one
  // from the scene itself rather than hiding boards the user can still open.
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    const scenes = await Promise.all(missing.map((id) => db.get(BOARD_STORE, id)));
    const tx = db.transaction(META_STORE, "readwrite");
    for (let index = 0; index < missing.length; index += 1) {
      const id = missing[index]!;
      const snapshot = scenes[index];
      if (!snapshot) continue;
      const meta = metaFor(id, snapshot);
      byId.set(id, meta);
      void tx.store.put(meta, id);
    }
    await tx.done;
  }

  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function updateMeta(id: string, patch: Partial<BoardMeta>): Promise<BoardMeta | null> {
  const db = await getDb();
  const current = await db.get(META_STORE, id);
  if (!current) return null;
  const next: BoardMeta = { ...current, ...patch, id };
  await db.put(META_STORE, next, id);
  return next;
}

export interface CreateBoardOptions {
  title?: string;
  camera?: Camera;
}

/** An empty notepad, ready to open. Nothing is written until it exists. */
export async function createBoard(
  id: string,
  { title, camera }: CreateBoardOptions = {},
): Promise<BoardMeta> {
  const now = Date.now();
  const snapshot: BoardSnapshot = {
    version: SCENE_VERSION,
    elements: [],
    camera: camera ?? { x: 0, y: 0, zoom: 1 },
    savedAt: now,
  };

  const db = await getDb();
  const meta: BoardMeta = {
    ...metaFor(id, snapshot),
    title: cleanTitle(title ?? "", defaultTitle(id)),
  };

  const tx = db.transaction([BOARD_STORE, META_STORE], "readwrite");
  await tx.objectStore(BOARD_STORE).put(snapshot, id);
  tx.objectStore(META_STORE).put(meta, id);
  await tx.done;

  return meta;
}

export async function renameBoard(id: string, title: string): Promise<BoardMeta | null> {
  const meta = await loadMeta(id);
  if (!meta) return null;
  return updateMeta(id, { title: cleanTitle(title, meta.title) });
}

export async function deleteBoard(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([BOARD_STORE, META_STORE], "readwrite");
  await tx.objectStore(BOARD_STORE).delete(id);
  await tx.objectStore(META_STORE).delete(id);
  await tx.done;
}
