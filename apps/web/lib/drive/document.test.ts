import { describe, expect, it } from "vitest";
import { createElement } from "@penpaper/engine";
import type { Element } from "@penpaper/shared";
import {
  BOARD_FILE_SUFFIX,
  boardFileName,
  isBoardDocument,
  mergeChanges,
  mergeElements,
  titleFromFileName,
} from "./document";

function element(id: string, updatedAt: number, patch: Partial<Element> = {}): Element {
  return {
    ...createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, id),
    id,
    updatedAt,
    ...patch,
  };
}

describe("Drive file naming", () => {
  it("appends the board suffix a person can recognise in Drive", () => {
    expect(boardFileName("Ideas")).toBe(`Ideas${BOARD_FILE_SUFFIX}`);
  });

  it("removes characters that break paths and downloads", () => {
    expect(boardFileName('Q3 / plan: "final"?')).toBe(`Q3 plan final${BOARD_FILE_SUFFIX}`);
  });

  it("falls back when a title is only whitespace", () => {
    expect(boardFileName("   ")).toBe(`Untitled notepad${BOARD_FILE_SUFFIX}`);
  });

  it("round-trips the title out of a file name", () => {
    const name = boardFileName("Physics notes");
    expect(titleFromFileName(name)).toBe("Physics notes");
  });

  it("leaves an un-suffixed name alone", () => {
    expect(titleFromFileName("Old export")).toBe("Old export");
  });
});

describe("board document guard", () => {
  const valid = {
    format: "penpaper.board",
    version: 1,
    boardId: "abc",
    title: "Ideas",
    savedAt: 1,
    elements: [element("a", 1)],
  };

  it("accepts the format PenPaper writes", () => {
    expect(isBoardDocument(valid)).toBe(true);
  });

  it("rejects another JSON file in the folder", () => {
    expect(isBoardDocument({ format: "something.else", elements: [] })).toBe(false);
    expect(isBoardDocument({ format: "penpaper.board", boardId: "abc" })).toBe(false);
    expect(isBoardDocument(null)).toBe(false);
  });
});

describe("mergeElements", () => {
  it("keeps an element only this device has", () => {
    const merged = mergeElements([element("local", 5)], [element("remote", 5)]);
    expect(merged.map((item) => item.id).sort()).toEqual(["local", "remote"]);
  });

  it("takes the newer edit regardless of which side it came from", () => {
    const older = element("a", 10, { strokeColor: "#000000" });
    const newer = element("a", 20, { strokeColor: "#e03131" });

    expect(mergeElements([older], [newer])[0]?.strokeColor).toBe("#e03131");
    expect(mergeElements([newer], [older])[0]?.strokeColor).toBe("#e03131");
  });

  it("keeps a newer tombstone so a deleted shape stays deleted", () => {
    const alive = element("a", 10);
    const deleted = element("a", 30, { isDeleted: true });

    expect(mergeElements([alive], [deleted])[0]?.isDeleted).toBe(true);
  });

  it("does not resurrect a shape deleted on the other device with an older copy", () => {
    const deleted = element("a", 30, { isDeleted: true });
    const stale = element("a", 10);

    expect(mergeElements([deleted], [stale])[0]?.isDeleted).toBe(true);
  });

  it("prefers the local copy on a tie to avoid a pointless write", () => {
    const local = element("a", 10, { strokeColor: "#1971c2" });
    const remote = element("a", 10, { strokeColor: "#2f9e44" });
    expect(mergeElements([local], [remote])[0]?.strokeColor).toBe("#1971c2");
  });
});

describe("mergeChanges", () => {
  it("is false when the merged scene is the local one", () => {
    const local = [element("a", 1), element("b", 2)];
    expect(mergeChanges(local, mergeElements(local, local))).toBe(false);
  });

  it("is true when the other device contributed a shape", () => {
    const local = [element("a", 1)];
    const merged = mergeElements(local, [element("b", 1)]);
    expect(mergeChanges(local, merged)).toBe(true);
  });

  it("is true when a shared shape has a newer version", () => {
    const local = [element("a", 1)];
    const merged = mergeElements(local, [element("a", 9)]);
    expect(mergeChanges(local, merged)).toBe(true);
  });
});
