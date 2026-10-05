import type { Element } from "@penpaper/shared";
import rough from "roughjs";
import type { Options } from "roughjs/bin/core";
import { arrowDrawable } from "./shapes/arrow";
import { diamondDrawable } from "./shapes/diamond";
import { ellipseDrawable } from "./shapes/ellipse";
import { lineDrawable } from "./shapes/line";
import { polygonDrawable } from "./shapes/polygon";
import { rectangleDrawable } from "./shapes/rectangle";

export type Drawable = ReturnType<ReturnType<typeof rough.generator>["rectangle"]>;
export type Generator = ReturnType<typeof rough.generator>;

/**
 * Drawables are pure geometry: same shape, same seed, same wobble.
 *
 * `x`, `y`, and `angle` are deliberately absent from the key — they are
 * applied as a canvas transform, so dragging a shape must not regenerate it.
 * That single decision is the difference between a smooth drag and a stutter
 * on a board full of hand-drawn shapes.
 */
function cacheKey(el: Element): string {
  return [
    el.type,
    Math.round(el.width),
    Math.round(el.height),
    el.seed,
    el.roughness,
    el.fillStyle,
    el.strokeStyle,
    el.backgroundColor,
    el.strokeWidth,
  ].join(":");
}

/** The canvas dash pattern for an element's stroke style. */
export function dashArray(el: Element): number[] {
  if (el.strokeStyle === "dashed") return [el.strokeWidth * 4, el.strokeWidth * 4];
  if (el.strokeStyle === "dotted") return [el.strokeWidth, el.strokeWidth * 2];
  return [];
}

function hasFill(el: Element): boolean {
  return el.backgroundColor !== "transparent" && el.backgroundColor !== "";
}

export function roughOptions(el: Element): Options {
  return {
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    roughness: el.roughness,
    seed: el.seed,
    fill: hasFill(el) ? el.backgroundColor : undefined,
    fillStyle: el.fillStyle,
    strokeLineDash: dashArray(el),
    preserveVertices: false,
  };
}

function generate(gen: Generator, el: Element): Drawable {
  const options = roughOptions(el);

  switch (el.type) {
    case "rectangle":
    case "image":
      return rectangleDrawable(gen, el, options);
    case "ellipse":
      return ellipseDrawable(gen, el, options);
    case "diamond":
      return diamondDrawable(gen, el, options);
    case "triangle":
    case "hexagon":
    case "star":
      return polygonDrawable(gen, el.type, el, options);
    case "line":
      return lineDrawable(gen, el, options);
    case "arrow":
      return arrowDrawable(gen, el, options);
    default:
      // Text and freedraw are not sketched: generating an empty drawable keeps
      // the cache's contract simple.
      return { shape: "rectangle", sets: [], options } as unknown as Drawable;
  }
}

const MAX_ENTRIES = 4096;
const EVICT_COUNT = 256;

export class RoughCache {
  private readonly entries = new Map<string, Drawable>();
  private readonly gen: Generator = rough.generator();
  private hits = 0;
  private misses = 0;

  get(el: Element): Drawable {
    const key = cacheKey(el);
    const cached = this.entries.get(key);
    if (cached) {
      this.hits += 1;
      return cached;
    }

    this.misses += 1;
    const drawable = generate(this.gen, el);

    // A 1,000-element board has to fit without a flush. Clearing the whole map
    // was cheap to write but meant every frame regenerated the first shapes
    // over and over once a board crossed the cap; evicting the oldest quarter
    // keeps repeat frames hitting while bounding memory on a phone.
    if (this.entries.size >= MAX_ENTRIES) {
      let evicted = 0;
      for (const oldest of this.entries.keys()) {
        this.entries.delete(oldest);
        evicted += 1;
        if (evicted >= EVICT_COUNT) break;
      }
    }
    this.entries.set(key, drawable);
    return drawable;
  }

  get hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
