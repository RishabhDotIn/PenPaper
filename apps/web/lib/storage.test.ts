import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "@penpaper/engine";
import { deleteBoard, loadBoard, saveBoard, type BoardSnapshot } from "./storage";

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
  });
});
