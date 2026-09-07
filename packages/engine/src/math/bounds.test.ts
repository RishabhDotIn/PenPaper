import { describe, expect, it } from "vitest";
import { createElement } from "../scene/factory";
import { boundsIntersect, elementBounds } from "./bounds";

describe("elementBounds", () => {
  it("returns the box itself when unrotated", () => {
    const el = createElement("rectangle", { x: 10, y: 20, width: 100, height: 50 }, "V");
    expect(elementBounds(el)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("expands bounds for a rotated rectangle", () => {
    const el = {
      ...createElement("rectangle", { x: 0, y: 0, width: 100, height: 50 }, "V"),
      angle: Math.PI / 4,
    };
    const b = elementBounds(el);
    expect(b.width).toBeCloseTo(106.066, 2);
    expect(b.height).toBeCloseTo(106.066, 2);
    // Rotation happens about the centre, so the centre is unchanged.
    expect(b.x + b.width / 2).toBeCloseTo(50, 6);
    expect(b.y + b.height / 2).toBeCloseTo(25, 6);
  });
});

describe("boundsIntersect", () => {
  it("detects overlap and honour a margin", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const touching = { x: 10, y: 0, width: 10, height: 10 };
    expect(boundsIntersect(a, touching)).toBe(false);
    expect(boundsIntersect(a, touching, 1)).toBe(true);
    expect(boundsIntersect(a, { x: 100, y: 100, width: 5, height: 5 })).toBe(false);
  });
});
