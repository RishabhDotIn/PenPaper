import { describe, expect, it } from "vitest";
import { createElement } from "../scene/factory";
import { RoughCache } from "./rough-cache";

function rectangle(seed: number) {
  return {
    ...createElement("rectangle", { x: 0, y: 0, width: 20, height: 16 }, "a"),
    seed,
  };
}

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
    for (let seed = 0; seed < 5_000; seed += 1) cache.get(rectangle(seed));

    expect(cache.size).toBeLessThanOrEqual(4_096);
    expect(cache.size).toBeGreaterThan(3_000);
  });

  it("keeps a whole 1,000-element board without a flush", () => {
    const cache = new RoughCache();
    for (let seed = 0; seed < 1_000; seed += 1) cache.get(rectangle(seed));

    // A full flush at the old 512-entry cap would leave only the last 488
    // entries, and the next frame would regenerate the first shapes forever.
    expect(cache.size).toBe(1_000);
  });

  it("reuses geometry for every shape on a repeat frame", () => {
    const cache = new RoughCache();
    const elements = Array.from({ length: 1_000 }, (_, seed) => rectangle(seed));

    for (const element of elements) cache.get(element);
    const hitsBefore = cache.hitRate;

    for (const element of elements) cache.get(element);

    expect(hitsBefore).toBe(0);
    expect(cache.hitRate).toBeCloseTo(0.5, 6);
  });
});
