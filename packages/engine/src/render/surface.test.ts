import { describe, expect, it } from "vitest";
import { computeBackingSize, visibleBounds } from "./surface";

describe("computeBackingSize", () => {
  it("caps the device pixel ratio", () => {
    expect(computeBackingSize(390, 844, 3, 2)).toEqual({ width: 780, height: 1688, dpr: 2 });
    expect(computeBackingSize(390, 844, 3, 1.5)).toEqual({ width: 585, height: 1266, dpr: 1.5 });
  });

  it("rounds to whole device pixels", () => {
    expect(computeBackingSize(100.4, 50.6, 1)).toEqual({ width: 100, height: 51, dpr: 1 });
  });

  it("survives a zero-sized box during first paint", () => {
    expect(computeBackingSize(0, 0, 2)).toEqual({ width: 0, height: 0, dpr: 2 });
  });
});

describe("visibleBounds", () => {
  it("maps the viewport into scene space", () => {
    const b = visibleBounds({ x: -100, y: -50, zoom: 2 }, { width: 800, height: 600 });
    expect(b).toEqual({ x: 50, y: 25, width: 400, height: 300 });
  });

  it("grows by the culling margin", () => {
    const b = visibleBounds({ x: 0, y: 0, zoom: 1 }, { width: 100, height: 100 }, 10);
    expect(b).toEqual({ x: -10, y: -10, width: 120, height: 120 });
  });
});
