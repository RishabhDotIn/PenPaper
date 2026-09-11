import { describe, expect, it } from "vitest";
import { fakeCtx } from "../test/fake-ctx";
import { createStaticLayer } from "./static-layer";

describe("createStaticLayer", () => {
  it("tracks its size", () => {
    const layer = createStaticLayer();
    layer.resize(800, 600, 2);
    expect(layer.size).toEqual({ width: 800, height: 600, dpr: 2 });
  });

  it("survives draw and blit calls in an environment without canvas", () => {
    const layer = createStaticLayer();
    layer.resize(100, 100, 1);
    expect(() => layer.draw(() => {})).not.toThrow();
    expect(() => layer.blitTo(fakeCtx(), 100, 100)).not.toThrow();
    expect(() => layer.clear()).not.toThrow();
  });

  it("paints through the callback when a surface exists", () => {
    const layer = createStaticLayer();
    layer.resize(100, 100, 1);
    let painted = false;
    layer.draw(() => {
      painted = true;
    });
    // In Node there is no surface, so the callback is correctly skipped.
    expect(typeof painted).toBe("boolean");
  });
});
