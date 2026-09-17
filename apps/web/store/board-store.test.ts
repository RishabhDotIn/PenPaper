import { beforeEach, describe, expect, it } from "vitest";
import { useBoardStore } from "./board-store";

beforeEach(() => {
  useBoardStore.getState().reset();
});

describe("useBoardStore", () => {
  it("starts empty and detached", () => {
    const state = useBoardStore.getState();
    expect(state).toMatchObject({
      boardId: null,
      status: "loading",
      elementCount: 0,
      savedAt: null,
    });
  });

  it("resets per-board fields when a new board is attached", () => {
    const store = useBoardStore.getState();
    store.setBoard("first");
    store.setElementCount(12);
    store.markSaved(1234);
    store.setStatus("ready");

    useBoardStore.getState().setBoard("second");

    expect(useBoardStore.getState()).toMatchObject({
      boardId: "second",
      elementCount: 0,
      savedAt: null,
      status: "loading",
    });
  });

  it("records the element count and last save time", () => {
    useBoardStore.getState().setElementCount(3);
    useBoardStore.getState().markSaved(999);

    expect(useBoardStore.getState().elementCount).toBe(3);
    expect(useBoardStore.getState().savedAt).toBe(999);
  });
});
