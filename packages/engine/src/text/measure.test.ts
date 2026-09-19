import { describe, expect, it } from "vitest";
import { createElement } from "../scene/factory";
import { estimateMeasure, textHeight, textLineCount, wrapText } from "./measure";

const measure = (text: string): number => text.length * 10;

describe("wrapText", () => {
  it("wraps on word boundaries without exceeding the width", () => {
    expect(wrapText("hello world again", 100, "16px sans", measure)).toEqual([
      "hello",
      "world",
      "again",
    ]);
  });

  it("keeps text that fits on one line", () => {
    expect(wrapText("hello world", 500, "f", measure)).toEqual(["hello world"]);
  });

  it("fills a line before starting the next one", () => {
    expect(wrapText("aaa bbb ccc", 70, "f", measure)).toEqual(["aaa bbb", "ccc"]);
  });

  it("preserves empty paragraphs from newlines", () => {
    expect(wrapText("a\n\nb", 500, "f", measure)).toEqual(["a", "", "b"]);
  });

  it("never breaks inside a long word", () => {
    expect(wrapText("supercalifragilistic", 30, "f", measure)).toEqual(["supercalifragilistic"]);
  });

  it("honours an explicit minimum width instead of collapsing", () => {
    // A zero-width box still lays out at MIN_TEXT_WIDTH, not at one word per
    // line of zero width.
    expect(wrapText("ab cd", 0, "f", measure)).toEqual(["ab", "cd"]);
  });
});

describe("textHeight", () => {
  it("counts wrapped lines and applies the line height", () => {
    const el = {
      ...createElement("text", { x: 0, y: 0, width: 100, height: 20 }, "a"),
      text: "one two three four",
      fontSize: 20,
      lineHeight: 1.25,
    };

    // 20 px font × 0.55 em → "one two" (7 chars ≈ 77 px) fits in 100 px;
    // "one two three" does not, so it becomes three lines.
    expect(textLineCount(el)).toBe(3);
    expect(textHeight(el)).toBeCloseTo(3 * 20 * 1.25, 6);
  });

  it("has a one-line floor, so an empty element still has a hit box", () => {
    const el = { ...createElement("text", { x: 0, y: 0, width: 100, height: 20 }, "a"), text: "" };
    expect(textLineCount(el)).toBe(1);
    expect(textHeight(el)).toBeGreaterThan(0);
  });

  it("accepts a real canvas measure function", () => {
    const el = {
      ...createElement("text", { x: 0, y: 0, width: 60, height: 20 }, "a"),
      text: "aaaa bbbb cccc",
      fontSize: 10,
      lineHeight: 2,
    };

    // measure: 10 px per character, width 60 → "aaaa" fits, nothing else does.
    const lines = textLineCount(el, (text) => text.length * 10);
    expect(lines).toBe(3);
    expect(textHeight(el, (text) => text.length * 10)).toBeCloseTo(3 * 10 * 2, 6);
  });
});

describe("estimateMeasure", () => {
  it("scales with font size", () => {
    const measureAt10 = estimateMeasure(10);
    const measureAt20 = estimateMeasure(20);
    expect(measureAt10("abcd", "")).toBeCloseTo(22, 6);
    expect(measureAt20("abcd", "")).toBeCloseTo(44, 6);
  });
});
