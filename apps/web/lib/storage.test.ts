import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "@penpaper/engine";
import {
  cleanTitle,
  createBoard,
  defaultTitle,
  deleteBoard,
  listBoards,
  loadBoard,
  loadMeta,
  renameBoard,
  saveBoard,
  updateMeta,
  type BoardSnapshot,
} from "./storage";

const CAMERA = { x: 10, y: 20, zoom: 1.5 };

function snapshot(): BoardSnapshot {
  return {
    version: 1,
    elements: [createElement("rectangle", { x: 0, y: 0, width: 100, height: 50 }, "a0")],
    camera: CAMERA,
    savedAt: 1_700_000_000_000,
  };
}

// Each test uses its own id so the cached connection and the shared fake
// database do not leak state between cases.
let counter = 0;
function boardId(): string {
  counter += 1;
  return `board-${counter}`;
}

describe("board storage", () => {
  let id: string;

  beforeEach(() => {
    id = boardId();
  });

  it("returns null for a board that was never saved", async () => {
    expect(await loadBoard(id)).toBeNull();
  });

  it("round-trips elements, camera, and timestamp", async () => {
    const value = snapshot();
    await saveBoard(id, value);

    await expect(loadBoard(id)).resolves.toEqual(value);
  });

  it("overwrites the same board instead of appending", async () => {
    const first = snapshot();
    await saveBoard(id, first);

    const second = snapshot();
    second.elements[0] = { ...second.elements[0]!, strokeColor: "#e03131" };
    second.savedAt += 1;
    await saveBoard(id, second);

    const loaded = await loadBoard(id);
    expect(loaded?.elements[0]?.strokeColor).toBe("#e03131");
    expect(loaded?.savedAt).toBe(second.savedAt);
  });

  it("keeps boards isolated by id", async () => {
    const other = boardId();
    await saveBoard(id, snapshot());

    expect(await loadBoard(other)).toBeNull();
  });

  it("deletes a board", async () => {
    await saveBoard(id, snapshot());
    await deleteBoard(id);

    expect(await loadBoard(id)).toBeNull();
    expect(await loadMeta(id)).toBeNull();
  });
});

describe("the shelf index", () => {
  let id: string;

  beforeEach(() => {
    id = boardId();
  });

  it("gives a saved board a card without reading it twice", async () => {
    const value = snapshot();
    value.elements.push(
      { ...createElement("ellipse", { x: 40, y: 40, width: 10, height: 10 }, "a1"), isDeleted: true },
    );
    await saveBoard(id, value);

    const meta = await loadMeta(id);
    expect(meta).toMatchObject({
      id,
      title: defaultTitle(id),
      elementCount: 1,
      updatedAt: value.savedAt,
    });
  });

  it("keeps the Drive relationship across an autosave", async () => {
    await saveBoard(id, snapshot());
    await updateMeta(id, { driveFileId: "file-1", driveVersion: "7", syncedAt: 123 });

    const next = snapshot();
    next.savedAt += 10;
    await saveBoard(id, next);

    expect(await loadMeta(id)).toMatchObject({
      driveFileId: "file-1",
      driveVersion: "7",
      syncedAt: 123,
      updatedAt: next.savedAt,
    });
  });

  it("creates an empty notepad that opens immediately", async () => {
    const meta = await createBoard(id, { title: "  Physics   notes " });

    expect(meta.title).toBe("Physics notes");
    expect(meta.elementCount).toBe(0);

    const snapshot = await loadBoard(id);
    expect(snapshot?.elements).toEqual([]);
    expect(snapshot?.camera).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("renames without changing the drawing, and refuses an empty name", async () => {
    await createBoard(id, { title: "First" });
    await renameBoard(id, "  Second   name ");
    expect((await loadMeta(id))?.title).toBe("Second name");

    await renameBoard(id, "    ");
    expect((await loadMeta(id))?.title).toBe("Second name");
  });

  it("orders the shelf newest first", async () => {
    const older = boardId();
    const newer = boardId();

    const first = snapshot();
    first.savedAt = 1_000;
    const second = snapshot();
    second.savedAt = 2_000;

    await saveBoard(older, first);
    await saveBoard(newer, second);

    const boards = (await listBoards()).filter(
      (board) => board.id === older || board.id === newer,
    );
    expect(boards.map((board) => board.id)).toEqual([newer, older]);
  });

  it("backfills a card for a board written before the shelf existed", async () => {
    await saveBoard(id, snapshot());

    // Simulate a v1 database: the scene is there, the card is not.
    const raw = await openDB("penpaper", 2);
    await raw.delete("meta", id);
    raw.close();

    const boards = await listBoards();
    expect(boards.find((board) => board.id === id)).toMatchObject({
      title: defaultTitle(id),
      elementCount: 1,
    });
  });

  it("leaves an unknown board alone when patching metadata", async () => {
    expect(await updateMeta("never-saved", { title: "Nope" })).toBeNull();
  });
});

describe("titles", () => {
  it("collapses whitespace and caps the length", () => {
    expect(cleanTitle("  a \n  b  ", "fallback")).toBe("a b");
    expect(cleanTitle("   ", "fallback")).toBe("fallback");
    expect(cleanTitle("x".repeat(200), "fallback")).toHaveLength(80);
  });
});
