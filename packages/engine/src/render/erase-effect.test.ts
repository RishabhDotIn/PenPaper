import { describe, expect, it } from "vitest";
import { ERASER_GHOST_MS, ERASER_TRAIL_FADE_MS, type EraserFrame, type EraserGhost } from "../eraser";
import { createElement } from "../scene/factory";
import { fakeCtx } from "../test/fake-ctx";
import { drawEraseGhosts, drawEraserOverlay } from "./erase-effect";
import { RoughCache } from "./rough-cache";
import { lightTheme } from "./theme";

const NOW = 10_000;

function ghost(t: number): EraserGhost {
  return {
    element: createElement("rectangle", { x: 10, y: 10, width: 60, height: 40 }, "V"),
    t,
  };
}

function frame(overrides: Partial<EraserFrame> = {}): EraserFrame {
  return { cursor: null, trail: [], ghosts: [], ...overrides };
}

describe("drawEraseGhosts", () => {
  it("paints a fresh ghost", () => {
    const ctx = fakeCtx();
    drawEraseGhosts(ctx, [ghost(NOW)], new RoughCache(), lightTheme, NOW);

    // The element is painted inside an opacity/shrink transform.
    expect(ctx.calls).toContain("save");
    expect(ctx.calls).toContain("restore");
  });

  it("stops painting once the ghost has fully faded", () => {
    const ctx = fakeCtx();
    drawEraseGhosts(ctx, [ghost(NOW - ERASER_GHOST_MS)], new RoughCache(), lightTheme, NOW);

    expect(ctx.calls).toHaveLength(0);
  });

  it("keeps painting the remaining ghosts after one has expired", () => {
    const ctx = fakeCtx();
    drawEraseGhosts(
      ctx,
      [ghost(NOW - ERASER_GHOST_MS * 2), ghost(NOW)],
      new RoughCache(),
      lightTheme,
      NOW,
    );

    expect(ctx.calls).toContain("save");
  });
});

describe("drawEraserOverlay", () => {
  it("draws nothing for an empty frame", () => {
    const ctx = fakeCtx();
    drawEraserOverlay(ctx, frame(), { x: 0, y: 0, zoom: 1 }, NOW);
    expect(ctx.calls).toHaveLength(0);
  });

  it("rings the pointer in screen space", () => {
    const ctx = fakeCtx();
    drawEraserOverlay(
      ctx,
      frame({ cursor: { x: 50, y: 60 } }),
      { x: 0, y: 0, zoom: 2 },
      NOW,
    );

    const arc = ctx.records.find((record) => record.name === "arc");
    // The camera doubles the scene point; the ring's own radius does not grow.
    expect(arc?.args.slice(0, 3)).toEqual([100, 120, 11]);
  });

  it("fades the trail instead of drawing a solid line", () => {
    const ctx = fakeCtx();
    drawEraserOverlay(
      ctx,
      frame({
        trail: [
          { x: 0, y: 0, t: NOW },
          { x: 20, y: 0, t: NOW },
        ],
      }),
      { x: 0, y: 0, zoom: 1 },
      NOW,
    );

    expect(ctx.calls).toContain("stroke");
    expect(ctx.globalAlpha).toBeGreaterThan(0);
    expect(ctx.globalAlpha).toBeLessThanOrEqual(0.2);
  });

  it("skips trail segments older than the fade window", () => {
    const ctx = fakeCtx();
    drawEraserOverlay(
      ctx,
      frame({
        trail: [
          { x: 0, y: 0, t: NOW - ERASER_TRAIL_FADE_MS },
          { x: 20, y: 0, t: NOW - ERASER_TRAIL_FADE_MS },
        ],
      }),
      { x: 0, y: 0, zoom: 1 },
      NOW,
    );

    expect(ctx.calls).not.toContain("stroke");
  });
});
