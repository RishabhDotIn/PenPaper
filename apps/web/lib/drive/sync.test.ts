import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "@penpaper/engine";
import type { Element } from "@penpaper/shared";
import type { RemoteBoard } from "./api";
import type { DriveBoardDocument } from "./document";

/**
 * The Drive network is mocked, but IndexedDB and the reconciler are real: these
 * tests are about the order of operations (pull, merge, save, upload) and about
 * never dropping an element, not about the REST shape.
 */

vi.mock("./auth", () => ({
  driveConfigured: () => true,
  hasSession: () => true,
  getAccessToken: () => "test-token",
  ensureSession: vi.fn(async () => ({ token: "test-token", expiresAt: 0, account: {} })),
  requestSession: vi.fn(async () => ({ token: "test-token", expiresAt: 0, account: {} })),
  DriveAuthError: class DriveAuthError extends Error {},
}));

vi.mock("./api", () => ({
  statRemoteBoard: vi.fn(),
  findRemoteBoard: vi.fn(),
  downloadBoard: vi.fn(),
  uploadBoard: vi.fn(),
  trashBoard: vi.fn(),
  listRemoteBoards: vi.fn(async () => []),
}));

import * as api from "./api";
import { createBoard, loadBoard, loadMeta, saveBoard, updateMeta } from "@/lib/storage";
import { DEFAULT_PREFERENCES, savePreferences } from "@/lib/preferences";
import { reconcileBoard } from "./sync";

function element(id: string, updatedAt: number): Element {
  return {
    ...createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, id),
    id,
    updatedAt,
  };
}

function remote(fileId: string, boardId: string, version: string, title = "Notebook"): RemoteBoard {
  return {
    fileId,
    boardId,
    title,
    modifiedTime: new Date(5_000).toISOString(),
    version,
  };
}

function document(boardId: string, elements: Element[]): DriveBoardDocument {
  return {
    format: "penpaper.board",
    version: 1,
    boardId,
    title: "Notebook",
    savedAt: 5_000,
    elements,
  };
}

function installStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
}

let counter = 0;
function boardId(): string {
  counter += 1;
  return `sync-board-${counter}`;
}

/** A saved board with one local shape, already linked to a Drive file. */
async function linkedBoard(): Promise<{ id: string; local: Element; updatedAt: number }> {
  const id = boardId();
  await createBoard(id, { title: "Notebook" });

  const local = element("local", 100);
  const savedAt = Date.now();
  await saveBoard(id, {
    version: 1,
    elements: [local],
    camera: { x: 0, y: 0, zoom: 1 },
    savedAt,
  });

  const meta = await loadMeta(id);
  return { id, local, updatedAt: meta?.updatedAt ?? savedAt };
}

describe("reconcileBoard", () => {
  beforeEach(() => {
    installStorage();
    vi.clearAllMocks();
  });

  it("pulls, merges, saves the union, then uploads one document with both shapes", async () => {
    const { id, local, updatedAt } = await linkedBoard();
    await updateMeta(id, {
      driveFileId: "file-1",
      driveVersion: "1",
      // Older than the local edit, so this device has work to push.
      syncedAt: updatedAt - 1,
    });

    const fromPhone = element("from-phone", 200);
    vi.mocked(api.statRemoteBoard).mockResolvedValue(remote("file-1", id, "2"));
    vi.mocked(api.downloadBoard).mockResolvedValue(document(id, [fromPhone]));
    vi.mocked(api.uploadBoard).mockResolvedValue(remote("file-1", id, "3"));

    const result = await reconcileBoard(id);

    // The canvas adopts the union, including the shape drawn elsewhere.
    expect(result.merged?.map((item) => item.id).sort()).toEqual(["from-phone", "local"]);

    const stored = await loadBoard(id);
    expect(stored?.elements.map((item) => item.id).sort()).toEqual(["from-phone", "local"]);

    expect(api.uploadBoard).toHaveBeenCalledTimes(1);
    const upload = vi.mocked(api.uploadBoard).mock.calls[0]?.[0];
    expect(upload?.fileId).toBe("file-1");
    expect(upload?.document.elements.map((item) => item.id).sort()).toEqual([
      "from-phone",
      "local",
    ]);
    // The local shape survived the merge; the other device's did not replace it.
    expect(upload?.document.elements.find((item) => item.id === "local")).toEqual(local);

    expect(await loadMeta(id)).toMatchObject({
      driveFileId: "file-1",
      driveVersion: "3",
    });
  });

  it("does nothing when the file has not moved and the device has nothing new", async () => {
    const { id, updatedAt } = await linkedBoard();
    await updateMeta(id, {
      driveFileId: "file-1",
      driveVersion: "4",
      syncedAt: updatedAt + 1,
    });

    vi.mocked(api.statRemoteBoard).mockResolvedValue(remote("file-1", id, "4"));

    const result = await reconcileBoard(id);

    expect(result.merged).toBeNull();
    expect(api.downloadBoard).not.toHaveBeenCalled();
    expect(api.uploadBoard).not.toHaveBeenCalled();
  });

  it("creates the Drive file for a board that is not there yet", async () => {
    const id = boardId();
    await createBoard(id, { title: "Brand new" });

    vi.mocked(api.findRemoteBoard).mockResolvedValue(null);
    vi.mocked(api.uploadBoard).mockResolvedValue(remote("file-new", id, "1", "Brand new"));

    const result = await reconcileBoard(id);

    expect(result.remote?.fileId).toBe("file-new");
    expect(api.uploadBoard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.uploadBoard).mock.calls[0]?.[0]?.fileId).toBeUndefined();
    expect(await loadMeta(id)).toMatchObject({
      driveFileId: "file-new",
      driveVersion: "1",
    });
  });

  it("recreates a file the user deleted in Drive instead of failing", async () => {
    const { id, updatedAt } = await linkedBoard();
    await updateMeta(id, {
      driveFileId: "file-gone",
      driveVersion: "2",
      syncedAt: updatedAt + 1,
    });

    vi.mocked(api.statRemoteBoard).mockResolvedValue(null);
    vi.mocked(api.findRemoteBoard).mockResolvedValue(null);
    vi.mocked(api.uploadBoard).mockResolvedValue(remote("file-reborn", id, "1"));

    const result = await reconcileBoard(id);

    expect(result.remote?.fileId).toBe("file-reborn");
    expect(vi.mocked(api.uploadBoard).mock.calls[0]?.[0]?.fileId).toBeUndefined();
    expect((await loadMeta(id))?.driveFileId).toBe("file-reborn");
  });

  it("creates the shelf card for a board written before metadata existed", async () => {
    const { id } = await linkedBoard();

    // Simulate a v1 database: the scene exists, the card and Drive link do not.
    const raw = await openDB("penpaper", 2);
    await raw.delete("meta", id);
    raw.close();

    vi.mocked(api.findRemoteBoard).mockResolvedValue(null);
    vi.mocked(api.uploadBoard).mockResolvedValue(remote("file-backfilled", id, "1"));

    const result = await reconcileBoard(id);

    expect(result.remote?.fileId).toBe("file-backfilled");
    expect(await loadMeta(id)).toMatchObject({
      driveFileId: "file-backfilled",
      driveVersion: "1",
    });
  });

  it("stays local when auto-sync is off and the notepad was not chosen", async () => {
    const { id } = await linkedBoard();
    savePreferences({ ...DEFAULT_PREFERENCES, autoSync: false });
    vi.mocked(api.findRemoteBoard).mockResolvedValue(null);

    const result = await reconcileBoard(id);

    expect(result.syncedAt).toBeNull();
    expect(api.uploadBoard).not.toHaveBeenCalled();
  });

  it("uploads a chosen notepad even with auto-sync off", async () => {
    const { id, updatedAt } = await linkedBoard();
    savePreferences({ ...DEFAULT_PREFERENCES, autoSync: false });
    await updateMeta(id, { inLibrary: true, syncedAt: updatedAt - 1 });
    vi.mocked(api.findRemoteBoard).mockResolvedValue(null);
    vi.mocked(api.uploadBoard).mockResolvedValue(remote("file-chosen", id, "1"));

    const result = await reconcileBoard(id);

    expect(result.remote?.fileId).toBe("file-chosen");
    expect(api.uploadBoard).toHaveBeenCalledTimes(1);
  });

  it("coalesces two saves into one reconciliation", async () => {
    const { id, updatedAt } = await linkedBoard();
    await updateMeta(id, {
      driveFileId: "file-1",
      driveVersion: "1",
      syncedAt: updatedAt - 1,
    });

    vi.mocked(api.statRemoteBoard).mockResolvedValue(remote("file-1", id, "1"));
    vi.mocked(api.uploadBoard).mockResolvedValue(remote("file-1", id, "2"));

    await Promise.all([reconcileBoard(id), reconcileBoard(id)]);

    expect(api.uploadBoard).toHaveBeenCalledTimes(1);
  });
});
