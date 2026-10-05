import { describe, expect, it } from "vitest";
import { createElement } from "../scene/factory";
import { fakeCtx } from "../test/fake-ctx";
import { getHandles } from "../selection/handles";
import { drawMarquee, drawSelection } from "./selection-overlay";
import { lightTheme } from "./theme";

const CAMERA = { x: 0, y: 0, zoom: 1 };

/**
 * `lineTo` calls in the silhouette path.
 *
 * A single-element selection also strokes a rotation stem, which starts with
 * a second `moveTo` and contributes one more segment. Slicing between the two
 * `moveTo`s keeps these assertions about the outline only.
 */
function outlineSegments(records: ReadonlyArray<{ name: string }>): number {
  const starts = records.flatMap((record, index) => (record.name === "moveTo" ? [index] : []));
  const [from, to] = starts;
  if (from === undefined || to === undefined) return 0;
  return records.slice(from, to).filter((record) => record.name === "lineTo").length;
}

describe("drawSelection", () => {
  it("draws one circle per handle for a single element", () => {
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    const ctx = fakeCtx();

    drawSelection(ctx, [el], CAMERA, lightTheme);

    const arcs = ctx.calls.filter((call) => call === "arc");
    expect(arcs).toHaveLength(getHandles(el, CAMERA).length);
  });

  it("draws the rotated outline, not an axis-aligned box", () => {
    const el = {
      ...createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V"),
      angle: Math.PI / 4,
    };
    const ctx = fakeCtx();

    drawSelection(ctx, [el], CAMERA, lightTheme);

    const firstMove = ctx.records.find((record) => record.name === "moveTo");
    expect(firstMove).toBeDefined();

    // The first corner of the outline sits 4 px outside (0, 0) before rotation
    // and at (50, 50 - 54√2) after a 45° turn. An axis-aligned box would still
    // start at (0, 0), so this is the assertion that catches a bounding-box
    // overlay.
    const [x, y] = firstMove?.args ?? [];
    expect(x).toBeCloseTo(50, 6);
    expect(y).toBeCloseTo(50 - 54 * Math.SQRT2, 6);
    expect(ctx.calls).toContain("closePath");
    expect(ctx.calls).not.toContain("strokeRect");
  });

  it("keeps the outline off a zero-height element so its stroke stays visible", () => {
    const el = createElement("line", { x: 0, y: 0, width: 100, height: 0 }, "V");
    const ctx = fakeCtx();

    drawSelection(ctx, [el], CAMERA, lightTheme);

    const firstMove = ctx.records.find((record) => record.name === "moveTo");
    expect(firstMove?.args).toEqual([-4, -4]);
  });

  it("traces an ellipse instead of boxing it", () => {
    const el = createElement("ellipse", { x: 0, y: 0, width: 100, height: 100 }, "V");
    const ctx = fakeCtx();

    drawSelection(ctx, [el], CAMERA, lightTheme);

    const ellipse = ctx.records.find((record) => record.name === "ellipse");
    expect(ellipse).toBeDefined();
    // Centre, radii, and rotation: 50 + 4 px of breathing room on each axis.
    expect(ellipse?.args).toEqual([50, 50, 54, 54, 0, 0, Math.PI * 2]);
    expect(ctx.calls).not.toContain("strokeRect");
  });

  it("traces a diamond's four corners rather than its bounding box", () => {
    const el = createElement("diamond", { x: 0, y: 0, width: 100, height: 100 }, "V");
    const ctx = fakeCtx();

    drawSelection(ctx, [el], CAMERA, lightTheme);

    const firstMove = ctx.records.find((record) => record.name === "moveTo");
    // Top point of the diamond: (50, 0) pushed out by the 4 px padding. A box
    // outline would start at (-4, -4).
    expect(firstMove?.args).toEqual([50, -4]);
    // Count only the silhouette, not the rotation stem's extra segment.
    expect(outlineSegments(ctx.records)).toBe(3);
    expect(ctx.calls).toContain("closePath");
    expect(ctx.calls).not.toContain("strokeRect");
  });

  it("outlines polygons with one edge per vertex", () => {
    for (const [type, edges] of [
      ["triangle", 3],
      ["hexagon", 6],
      ["star", 10],
    ] as const) {
      const el = createElement(type, { x: 0, y: 0, width: 100, height: 100 }, "V");
      const ctx = fakeCtx();

      drawSelection(ctx, [el], CAMERA, lightTheme);

      expect(outlineSegments(ctx.records)).toBe(edges - 1);
      expect(ctx.calls).toContain("closePath");
      expect(ctx.calls).not.toContain("strokeRect");
    }
  });

  it("draws a group box without individual handles", () => {
    const a = createElement("rectangle", { x: 0, y: 0, width: 50, height: 50 }, "V");
    const b = createElement("ellipse", { x: 100, y: 100, width: 50, height: 50 }, "W");
    const ctx = fakeCtx();

    drawSelection(ctx, [a, b], CAMERA, lightTheme);

    expect(ctx.calls).toContain("fillRect");
    expect(ctx.calls).toContain("strokeRect");
    expect(ctx.calls).not.toContain("arc");
  });

  it("does nothing for an empty selection", () => {
    const ctx = fakeCtx();
    drawSelection(ctx, [], CAMERA, lightTheme);
    expect(ctx.calls).toHaveLength(0);
  });
});

describe("drawMarquee", () => {
  it("normalises a box dragged up and to the left", () => {
    const ctx = fakeCtx();
    expect(() => drawMarquee(ctx, { x: 100, y: 100 }, { x: 20, y: 40 }, lightTheme)).not.toThrow();
    expect(ctx.calls).toContain("fillRect");
    expect(ctx.calls).toContain("strokeRect");
  });
});
