import { describe, expect, it } from "vitest";
import { createElement } from "../scene/factory";
import { fakeCtx } from "../test/fake-ctx";
import { getHandles } from "../selection/handles";
import { drawMarquee, drawSelection } from "./selection-overlay";
import { lightTheme } from "./theme";

const CAMERA = { x: 0, y: 0, zoom: 1 };

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

    // The first corner of the outline sits at (0, 0) before rotation and at
    // (50, 50 - 50√2) after a 45° turn. An axis-aligned box would still start
    // at (0, 0), so this is the assertion that catches a bounding-box overlay.
    const [x, y] = firstMove?.args ?? [];
    expect(x).toBeCloseTo(50, 6);
    expect(y).toBeCloseTo(50 - 50 * Math.SQRT2, 6);
    expect(ctx.calls).toContain("closePath");
    expect(ctx.calls).not.toContain("strokeRect");
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
