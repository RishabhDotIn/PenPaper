import { describe, expect, it } from "vitest";
import { createElement } from "../../scene/factory";
import { fakeCtx } from "../../test/fake-ctx";
import { RoughCache } from "../rough-cache";
import { drawElement, wrapText } from "./index";
import { freedrawOutline, traceOutline } from "./freedraw";
import { darkTheme, lightTheme } from "../theme";

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

  it("maps the default ink to the active theme", () => {
    const el = createElement("rectangle", { x: 0, y: 0, width: 50, height: 50 }, "V");
    const ctx = fakeCtx();

    drawElement(ctx, el, new RoughCache(), darkTheme);

    expect(ctx.strokeStyle).toBe(darkTheme.stroke);
  });

  it("keeps a chosen accent colour in either theme", () => {
    const el = { ...createElement("text", { x: 0, y: 0, width: 100, height: 40 }, "V"), text: "hi", strokeColor: "#e03131" };
    const ctx = fakeCtx();

    drawElement(ctx, el, new RoughCache(), darkTheme);

    expect(ctx.fillStyle).toBe("#e03131");
  });

  it("applies the dash pattern to a dashed outline, and only to the outline", () => {
    const el = {
      ...createElement("rectangle", { x: 0, y: 0, width: 80, height: 40 }, "V"),
      strokeStyle: "dashed" as const,
      strokeWidth: 2 as const,
      backgroundColor: "#a5d8ff",
    };
    const ctx = fakeCtx();

    drawElement(ctx, el, new RoughCache(), lightTheme);

    const dashes = ctx.records
      .filter((record) => record.name === "setLineDash")
      .map((record) => record.args[0]);
    expect(dashes).toContainEqual([8, 8]);
    // Hatched fills are texture, not outline: they must stay solid.
    expect(dashes).toContainEqual([]);
  });

  it("leaves a solid outline undashed", () => {
    const el = createElement("ellipse", { x: 0, y: 0, width: 80, height: 40 }, "V");
    const ctx = fakeCtx();

    drawElement(ctx, el, new RoughCache(), lightTheme);

    const dashes = ctx.records
      .filter((record) => record.name === "setLineDash")
      .map((record) => record.args[0]);
    expect(dashes.every((dash) => Array.isArray(dash) && dash.length === 0)).toBe(true);
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

  it("strokes a dashed centre line instead of filling the outline", () => {
    const el = {
      ...createElement("freedraw", { x: 0, y: 0, width: 80, height: 24 }, "V"),
      points: [
        [0, 0, 0.5],
        [20, 8, 0.5],
        [50, 4, 0.5],
        [80, 24, 0.5],
      ],
      strokeStyle: "dashed" as const,
      strokeWidth: 2 as const,
    };
    const ctx = fakeCtx();

    drawElement(ctx, el, new RoughCache(), lightTheme);

    expect(ctx.calls).toContain("stroke");
    expect(ctx.calls).not.toContain("fill");
    const dash = ctx.records.find(
      (record) => record.name === "setLineDash" && (record.args[0] as number[]).length > 0,
    );
    const [on, off] = dash?.args[0] as number[];
    expect(on).toBeCloseTo(7.8, 5);
    expect(off).toBeCloseTo(5.7, 5);
  });

  it("draws dots, not dashes, for a dotted pen", () => {
    const el = {
      ...createElement("freedraw", { x: 0, y: 0, width: 80, height: 24 }, "V"),
      points: [
        [0, 0, 0.5],
        [40, 8, 0.5],
        [80, 24, 0.5],
      ],
      strokeStyle: "dotted" as const,
      strokeWidth: 2 as const,
    };
    const ctx = fakeCtx();

    drawElement(ctx, el, new RoughCache(), lightTheme);

    const dash = ctx.records.find(
      (record) => record.name === "setLineDash" && (record.args[0] as number[]).length > 0,
    );
    expect((dash?.args[0] as number[])[0]).toBeLessThan(1);
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
