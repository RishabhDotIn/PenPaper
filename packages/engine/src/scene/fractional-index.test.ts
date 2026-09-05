import { describe, expect, it } from "vitest";
import { indexBetween } from "./fractional-index";

describe("indexBetween", () => {
  it("places a key strictly between two neighbours", () => {
    const a = indexBetween(null, null);
    const b = indexBetween(a, null);
    const c = indexBetween(a, b);
    expect(a < b).toBe(true);
    expect(a < c && c < b).toBe(true);
  });

  it("stays ordered across 200 random insertions", () => {
    let keys = [indexBetween(null, null)];
    for (let i = 0; i < 200; i++) {
      const at = Math.floor(Math.random() * (keys.length + 1));
      const key = indexBetween(keys[at - 1] ?? null, keys[at] ?? null);
      keys = [...keys.slice(0, at), key, ...keys.slice(at)];
    }
    const sorted = [...keys].sort();
    expect(sorted).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
