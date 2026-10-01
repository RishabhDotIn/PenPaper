import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting a synced notepad offline must not let the next sync pull it back.
 * The resolver keeps a small device-local list of file ids to trash.
 */

vi.mock("./auth", () => ({
  driveConfigured: vi.fn(() => true),
  hasSession: vi.fn(() => true),
  getAccessToken: () => "test-token",
  ensureSession: vi.fn(),
  requestSession: vi.fn(),
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
import * as auth from "./auth";
import { createBoard, loadBoard, loadMeta, updateMeta } from "@/lib/storage";
import { deleteBoardEverywhere, syncLibrary, unpublishBoard } from "./sync";

const PENDING_KEY = "penpaper:drive:pending-deletes:v1";

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
async function syncedBoard(): Promise<string> {
  counter += 1;
  const id = `offline-delete-${counter}`;
  await createBoard(id, { title: "On the phone" });
  await updateMeta(id, { driveFileId: `file-${id}`, driveVersion: "1" });
  return id;
}

describe("offline deletion of a synced notepad", () => {
  beforeEach(() => {
    installStorage();
    vi.clearAllMocks();
    vi.mocked(auth.hasSession).mockReturnValue(true);
    vi.mocked(auth.driveConfigured).mockReturnValue(true);
  });

  it("trashes the file immediately when connected", async () => {
    const id = await syncedBoard();

    await deleteBoardEverywhere(id);

    expect(api.trashBoard).toHaveBeenCalledWith(`file-${id}`);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(await loadBoard(id)).toBeNull();
  });

  it("remembers the file when offline and trashes it on the next sync", async () => {
    const id = await syncedBoard();
    vi.mocked(auth.hasSession).mockReturnValue(false);

    await deleteBoardEverywhere(id);

    expect(await loadBoard(id)).toBeNull();
    expect(api.trashBoard).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]")).toEqual([`file-${id}`]);

    vi.mocked(auth.hasSession).mockReturnValue(true);
    await syncLibrary();

    expect(api.trashBoard).toHaveBeenCalledWith(`file-${id}`);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("does not retry a file that is already gone", async () => {
    const id = await syncedBoard();
    vi.mocked(auth.hasSession).mockReturnValue(false);
    await deleteBoardEverywhere(id);

    vi.mocked(auth.hasSession).mockReturnValue(true);
    const gone = Object.assign(new Error("File not found"), { status: 404 });
    vi.mocked(api.trashBoard).mockRejectedValue(gone);

    await syncLibrary();

    // A 404 means the job is done; keeping it queued would retry forever.
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("keeps a failed trash queued for the next attempt", async () => {
    const id = await syncedBoard();
    vi.mocked(auth.hasSession).mockReturnValue(false);
    await deleteBoardEverywhere(id);

    vi.mocked(auth.hasSession).mockReturnValue(true);
    vi.mocked(api.trashBoard).mockRejectedValue(
      Object.assign(new Error("Server error"), { status: 500 }),
    );

    await syncLibrary();

    expect(JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]")).toEqual([`file-${id}`]);
  });

  it("unpublishing offline clears the local link and queues the trash", async () => {
    const id = await syncedBoard();
    vi.mocked(auth.hasSession).mockReturnValue(false);

    await unpublishBoard(id);

    // The notepad stays; only its relationship to Drive is removed.
    expect(await loadBoard(id)).not.toBeNull();
    expect((await loadMeta(id))?.driveFileId).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]")).toEqual([`file-${id}`]);
  });
});
