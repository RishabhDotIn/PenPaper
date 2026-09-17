import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Camera, SceneSnapshot } from "@penpaper/engine";

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

interface PenPaperDB extends DBSchema {
  boards: {
    key: string;
    value: BoardSnapshot;
  };
}

const DB_NAME = "penpaper";
const DB_VERSION = 1;
const STORE = "boards";

let handle: Promise<IDBPDatabase<PenPaperDB>> | null = null;

function getDb(): Promise<IDBPDatabase<PenPaperDB>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("PenPaper: IndexedDB is not available"));
  }

  // One connection for the whole tab: opening per save would serialise writes
  // behind a fresh upgrade check on every autosave tick.
  handle ??= openDB<PenPaperDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    },
  });

  return handle;
}

export async function saveBoard(id: string, snapshot: BoardSnapshot): Promise<void> {
  const db = await getDb();
  await db.put(STORE, snapshot, id);
}

export async function loadBoard(id: string): Promise<BoardSnapshot | null> {
  const db = await getDb();
  return (await db.get(STORE, id)) ?? null;
}

export async function deleteBoard(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}
