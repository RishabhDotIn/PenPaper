import { describe, expect, it } from "vitest";
import { createElement } from "../scene/factory";
import { RoughCache } from "./rough-cache";

describe("RoughCache", () => {
  it("reuses the drawable when geometry and style are unchanged", () => {
    const cache = new RoughCache();
    const el = createElement("rectangle", { x: 0, y: 0, width: 80, height: 40 }, "V");

    const first = cache.get(el);
    expect(cache.get({ ...el, x: 999 })).toBe(first);
    expect(cache.get({ ...el, backgroundColor: "#f00" })).not.toBe(first);
  });

  it("reuses across copies of the same element", () => {
    const cache = new RoughCache();
    const el = createElement("ellipse", { x: 0, y: 0, width: 80, height: 40 }, "V");

    const first = cache.get(el);
    expect(cache.get({ ...el })).toBe(first);
    expect(cache.hitRate).toBeCloseTo(0.5, 6);
  });

  it("regenerates when the seed changes, so a shape can be reshuffled", () => {
    const cache = new RoughCache();
    const el = createElement("rectangle", { x: 0, y: 0, width: 80, height: 40 }, "V");

    const first = cache.get(el);
    expect(cache.get({ ...el, seed: el.seed + 1 })).not.toBe(first);
  });

  it("stays bounded under many distinct elements", () => {
    const cache = new RoughCache();
    for (let i = 0; i < 1500; i += 1) {
      cache.get(createElement("rectangle", { x: 0, y: 0, width: i + 1, height: 10 }, "V"));
    }
    expect(cache.size).toBeLessThanOrEqual(512);
  });
});
