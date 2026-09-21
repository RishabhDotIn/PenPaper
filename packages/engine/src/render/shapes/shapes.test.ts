import { describe, expect, it } from "vitest";
import { createElement } from "../../scene/factory";
import { fakeCtx } from "../../test/fake-ctx";
import { RoughCache } from "../rough-cache";
import { drawElement, wrapText } from "./index";
import { freedrawOutline, traceOutline } from "./freedraw";
import { lightTheme } from "../theme";

const EVERY_TYPE = [
  "rectangle",
  "ellipse",
  "diamond",
  "line",
  "arrow",
  "freedraw",
  "text",
  "image",
] as const;

describe("drawElement", () => {
  it("draws every shape type without throwing", () => {
    for (const type of EVERY_TYPE) {
      const el = createElement(type, { x: 0, y: 0, width: 50, height: 50 }, "V");
      expect(() => drawElement(fakeCtx(), el, new RoughCache(), lightTheme)).not.toThrow();
    }
  });

  it("draws a rotated element without throwing", () => {
    const el = { ...createElement("diamond", { x: 0, y: 0, width: 50, height: 50 }, "V"), angle: 0.7 };
    const ctx = fakeCtx();
    expect(() => drawElement(ctx, el, new RoughCache(), lightTheme)).not.toThrow();
    expect(ctx.calls).toContain("rotate");
  });

  it("honours opacity", () => {
    const el = { ...createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, "V"), opacity: 40 };
    const ctx = fakeCtx();
    drawElement(ctx, el, new RoughCache(), lightTheme);
    expect(ctx.globalAlpha).toBeCloseTo(0.4, 6);
  });

  it("draws text with the element's own font size", () => {
    const el = { ...createElement("text", { x: 0, y: 0, width: 200, height: 40 }, "V"), text: "hello" };
    const ctx = fakeCtx();
    drawElement(ctx, el, new RoughCache(), lightTheme);
    expect(String(ctx.font)).toContain("20px");
  });
});

describe("freedraw", () => {
  it("traces the outline with curves, not raw segments", () => {
    const outline = freedrawOutline([
      [0, 0, 0.5],
      [40, 12, 0.5],
      [80, 0, 0.5],
    ]);
    const ctx = fakeCtx();

    traceOutline(ctx, outline);

    expect(ctx.calls).toContain("quadraticCurveTo");
    expect(ctx.calls).not.toContain("lineTo");
    expect(ctx.calls).toContain("closePath");
  });

  it("does not start a path for an outline too short to fill", () => {
    const ctx = fakeCtx();
    traceOutline(ctx, [[0, 0], [4, 4]]);
    expect(ctx.calls).not.toContain("beginPath");
  });
});

describe("wrapText", () => {
  const measure = (text: string): number => text.length * 10;

  it("keeps a short line on one row", () => {
    expect(wrapText("hello world", 500, "f", measure)).toEqual(["hello world"]);
  });

  it("wraps at word boundaries", () => {
    expect(wrapText("aaa bbb ccc", 70, "f", measure)).toEqual(["aaa bbb", "ccc"]);
  });

  it("preserves explicit newlines, including empty ones", () => {
    expect(wrapText("a\n\nb", 500, "f", measure)).toEqual(["a", "", "b"]);
  });

  it("never splits a single long word", () => {
    expect(wrapText("supercalifragilistic", 30, "f", measure)).toEqual(["supercalifragilistic"]);
  });
});
