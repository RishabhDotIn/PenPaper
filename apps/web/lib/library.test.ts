import { describe, expect, it } from "vitest";
import type { RemoteBoard } from "@/lib/drive/api";
import type { BoardMeta } from "@/lib/storage";
import { buildShelf, describeCount, formatAgo } from "./library";

function meta(id: string, patch: Partial<BoardMeta> = {}): BoardMeta {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1_000,
    elementCount: 3,
    ...patch,
  };
}

function remote(boardId: string, patch: Partial<RemoteBoard> = {}): RemoteBoard {
  return {
    fileId: `file-${boardId}`,
    boardId,
    title: boardId,
    modifiedTime: new Date(2_000).toISOString(),
    version: "1",
    ...patch,
  };
}

describe("buildShelf", () => {
  it("lists a board that only exists on this device", () => {
    const [item] = buildShelf([meta("local-only")], []);

    expect(item).toMatchObject({
      id: "local-only",
      source: "local",
      elementCount: 3,
      inLibrary: false,
    });
    expect(item?.driveFileId).toBeUndefined();
  });

  it("lists a board that only exists in Drive, without pretending to know its size", () => {
    const [item] = buildShelf([], [remote("from-drive", { title: "Physics" })]);

    expect(item).toMatchObject({
      id: "from-drive",
      title: "Physics",
      source: "remote",
      elementCount: -1,
      inLibrary: true,
      driveFileId: "file-from-drive",
    });
  });

  it("joins the two copies of the same board and prefers the remote title", () => {
    const [item] = buildShelf(
      [meta("both", { title: "Old name", driveFileId: "file-both" })],
      [remote("both", { title: "New name" })],
    );

    expect(item).toMatchObject({
      source: "both",
      title: "New name",
      inLibrary: true,
      driveFileId: "file-both",
    });
    // The shelf keeps the device's element count: it is the copy it can open
    // instantly, without a download.
    expect(item?.elementCount).toBe(3);
  });

  it("treats a chosen board as part of the library even before the first upload", () => {
    const [item] = buildShelf([meta("chosen", { inLibrary: true })], []);
    expect(item?.inLibrary).toBe(true);
  });

  it("orders by the newer of the two clocks", () => {
    const items = buildShelf(
      [meta("old", { updatedAt: 1_000 })],
      [
        remote("remote-new", { modifiedTime: new Date(9_000).toISOString() }),
        remote("old", { modifiedTime: new Date(500).toISOString() }),
      ],
    );

    expect(items.map((item) => item.id)).toEqual(["remote-new", "old"]);
  });

  it("uses the newer local edit even when Drive has not caught up", () => {
    const [item] = buildShelf(
      [meta("a", { updatedAt: 9_000 })],
      [remote("a", { modifiedTime: new Date(1_000).toISOString() })],
    );
    expect(item?.updatedAt).toBe(9_000);
  });
});

describe("formatAgo", () => {
  const now = 1_700_000_000_000;

  it("says nothing has synced when there is no timestamp", () => {
    expect(formatAgo(0, now)).toBe("not synced yet");
    expect(formatAgo(Number.NaN, now)).toBe("not synced yet");
  });

  it("uses the shortest truthful phrase", () => {
    expect(formatAgo(now - 10_000, now)).toBe("just now");
    expect(formatAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatAgo(now - 30 * 3_600_000, now)).toBe("yesterday");
    expect(formatAgo(now - 5 * 86_400_000, now)).toBe("5 days ago");
  });
});

describe("describeCount", () => {
  it("distinguishes an unopened Drive board from an empty one", () => {
    expect(describeCount(-1)).toBe("In Drive");
    expect(describeCount(0)).toBe("Empty");
    expect(describeCount(1)).toBe("1 shape");
    expect(describeCount(12)).toBe("12 shapes");
  });
});
