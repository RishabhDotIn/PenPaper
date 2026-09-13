/**
 * A Canvas 2D context that swallows every call.
 *
 * jsdom ships no rasteriser, and pulling in `canvas` would drag a native
 * dependency into a package that must stay installable anywhere. Shape drawing
 * is verified by Playwright against a real canvas; these tests verify the
 * logic around it — culling, caching, dirty flags.
 */
export interface FakeContext extends CanvasRenderingContext2D {
  /** Method names called since creation, in order. */
  readonly calls: string[];
  /** Method names with their arguments, for geometry assertions. */
  readonly records: Array<{ readonly name: string; readonly args: readonly unknown[] }>;
  reset(): void;
}

const VALUE_PROPERTIES = new Set([
  "globalAlpha",
  "globalCompositeOperation",
  "lineWidth",
  "lineCap",
  "lineJoin",
  "miterLimit",
  "strokeStyle",
  "fillStyle",
  "font",
  "textAlign",
  "textBaseline",
  "direction",
  "filter",
  "imageSmoothingEnabled",
  "imageSmoothingQuality",
]);

export function fakeCtx(): FakeContext {
  const calls: string[] = [];
  const records: Array<{ name: string; args: readonly unknown[] }> = [];
  const values: Record<string, unknown> = {
    canvas: { width: 800, height: 600 },
  };

  const target = {
    ...values,
    calls,
    records,
    reset: () => {
      calls.length = 0;
      records.length = 0;
    },
    measureText: (text: string) => ({ width: text.length * 8 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => null,
  } as unknown as Record<string, unknown>;

  return new Proxy(target, {
    get(obj, prop) {
      if (typeof prop !== "string") return Reflect.get(obj, prop);
      if (prop in obj) return Reflect.get(obj, prop);
      if (VALUE_PROPERTIES.has(prop)) return obj[prop];
      return (...args: unknown[]) => {
        calls.push(prop);
        records.push({ name: prop, args });
        return undefined;
      };
    },
    set(obj, prop, value) {
      if (typeof prop === "string") obj[prop] = value;
      return true;
    },
  }) as unknown as FakeContext;
}
