import { describe, expect, it } from "vitest";
import {
  SHAPE_TOOLS,
  TOOL_LABELS,
  TOOL_SHORTCUTS,
  isShapeTool,
  toolShortcut,
  type Tool,
} from "./tools";

const GEOMETRY: readonly Tool[] = [
  "rectangle",
  "diamond",
  "ellipse",
  "triangle",
  "hexagon",
  "star",
];

describe("TOOL_SHORTCUTS", () => {
  it("binds every geometry shape to a letter, and keeps the legacy digits", () => {
    // The palette prints one key per row, so a shape without a key is a row
    // that silently looks unfinished next to its neighbours.
    for (const tool of GEOMETRY) {
      const keys = Object.entries(TOOL_SHORTCUTS)
        .filter(([, bound]) => bound === tool)
        .map(([key]) => key);

      expect(keys, `${tool} should have a letter`).toEqual(
        expect.arrayContaining([expect.stringMatching(/^[a-z]$/)]),
      );
    }

    // 5, 6, and 7 stayed with arrow, line, and the pen, so only the first
    // three shapes carry a digit as well as their letter.
    for (const [key, tool] of [
      ["2", "rectangle"],
      ["3", "diamond"],
      ["4", "ellipse"],
    ] as const) {
      expect(TOOL_SHORTCUTS[key]).toBe(tool);
    }
  });

  it("gives each geometry shape its own letter, so no row repeats a key", () => {
    const letters = Object.entries(TOOL_SHORTCUTS)
      .filter(([key, tool]) => /^[a-z]$/.test(key) && GEOMETRY.includes(tool))
      .map(([key]) => key)
      .sort();

    expect(letters).toEqual(["d", "g", "o", "r", "s", "t"]);
  });

  it("leaves no tool unreachable", () => {
    const tools = Object.values(TOOL_SHORTCUTS);
    for (const tool of Object.keys(TOOL_LABELS) as Tool[]) {
      expect(tools).toContain(tool);
    }
  });

  it("keeps the hand, selection, and laser letters", () => {
    expect(TOOL_SHORTCUTS.h).toBe("hand");
    expect(TOOL_SHORTCUTS.v).toBe("select");
    expect(TOOL_SHORTCUTS.l).toBe("laser");
  });
});

describe("toolShortcut", () => {
  it("prints the letter for a shape, even though it also has a digit", () => {
    expect(toolShortcut("rectangle")).toBe("R");
    expect(toolShortcut("diamond")).toBe("D");
    expect(toolShortcut("ellipse")).toBe("O");
  });

  it("prints a letter for every shape the palette lists", () => {
    expect(GEOMETRY.map((tool) => toolShortcut(tool))).toEqual(["R", "D", "O", "T", "G", "S"]);
  });

  it("falls back to the digit for tools that only have one", () => {
    expect(toolShortcut("arrow")).toBe("5");
    expect(toolShortcut("freedraw")).toBe("7");
    expect(toolShortcut("laser")).toBe("L");
  });

  it("has an answer for every tool", () => {
    for (const tool of Object.keys(TOOL_LABELS) as Tool[]) {
      expect(toolShortcut(tool), `${tool} needs a printable key`).toMatch(/^[A-Z0-9]$/);
    }
  });
});

describe("isShapeTool", () => {
  it("accepts every tool that starts a new element", () => {
    for (const tool of GEOMETRY) expect(isShapeTool(tool)).toBe(true);
    expect(isShapeTool("arrow")).toBe(true);
    expect(isShapeTool("text")).toBe(true);
  });

  it("rejects the tools that manipulate the board", () => {
    for (const tool of ["select", "hand", "eraser", "laser"] as const) {
      expect(isShapeTool(tool)).toBe(false);
    }
  });

  it("covers exactly the shape map", () => {
    expect(Object.keys(SHAPE_TOOLS).sort()).toEqual(
      [
        "arrow",
        "diamond",
        "ellipse",
        "freedraw",
        "hexagon",
        "line",
        "rectangle",
        "star",
        "text",
        "triangle",
      ].sort(),
    );
  });
});
