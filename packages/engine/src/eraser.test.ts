import { describe, expect, it } from "vitest";
import {
  ERASER_GHOST_MS,
  ERASER_TRAIL_FADE_MS,
  eraserGhostProgress,
  eraserTrailStrength,
  type EraserGhost,
} from "./eraser";
import { createElement } from "./scene/factory";

describe("eraserTrailStrength", () => {
  const point = { x: 0, y: 0, t: 1_000 };

  it("is solid at the head and gone once the fade window passes", () => {
    expect(eraserTrailStrength(point, 1_000)).toBe(1);
    expect(eraserTrailStrength(point, 1_000 + ERASER_TRAIL_FADE_MS)).toBe(0);
    expect(eraserTrailStrength(point, 1_000 + ERASER_TRAIL_FADE_MS * 2)).toBe(0);
  });

  it("eases out rather than fading linearly", () => {
    // Halfway through the window the squared curve is at a quarter strength;
    // a linear ramp would still be at 0.5 and read as a static grey line.
    expect(eraserTrailStrength(point, 1_000 + ERASER_TRAIL_FADE_MS / 2)).toBeCloseTo(0.25, 6);
  });
});

describe("eraserGhostProgress", () => {
  const ghost: EraserGhost = {
    element: createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, "V"),
    t: 2_000,
  };

  it("runs from zero to one over the ghost's life", () => {
    expect(eraserGhostProgress(ghost, 2_000)).toBe(0);
    expect(eraserGhostProgress(ghost, 2_000 + ERASER_GHOST_MS / 2)).toBeCloseTo(0.5, 6);
    expect(eraserGhostProgress(ghost, 2_000 + ERASER_GHOST_MS)).toBe(1);
  });

  it("clamps, so a stale frame never runs backwards or past one", () => {
    expect(eraserGhostProgress(ghost, 1_000)).toBe(0);
    expect(eraserGhostProgress(ghost, 9_000)).toBe(1);
  });
});
