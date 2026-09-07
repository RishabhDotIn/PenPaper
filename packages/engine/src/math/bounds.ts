import type { Bounds, Element, Point } from "@penpaper/shared";

/**
 * Axis-aligned bounds of an element, accounting for rotation.
 *
 * Rotation is about the element centre, so the hull is computed by rotating
 * the four corners of the unrotated box and taking their extremes. Doing it
 * this way (instead of inflating the box) keeps culling tight: a 45° square
 * is 1.41× its side, not 2×.
 */
export function elementBounds(el: Element): Bounds {
  if (el.angle === 0) {
    return { x: el.x, y: el.y, width: el.width, height: el.height };
  }

  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const cos = Math.cos(el.angle);
  const sin = Math.sin(el.angle);
  const halfW = el.width / 2;
  const halfH = el.height / 2;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const corners: ReadonlyArray<readonly [number, number]> = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];

  for (const [dx, dy] of corners) {
    const x = cx + dx * cos - dy * sin;
    const y = cy + dx * sin + dy * cos;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Closed-interval overlap, so a margin of 0 excludes merely touching boxes. */
export function boundsIntersect(a: Bounds, b: Bounds, margin = 0): boolean {
  return (
    a.x - margin < b.x + b.width &&
    b.x - margin < a.x + a.width &&
    a.y - margin < b.y + b.height &&
    b.y - margin < a.y + a.height
  );
}

export function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function expandBounds(b: Bounds, by: number): Bounds {
  return { x: b.x - by, y: b.y - by, width: b.width + by * 2, height: b.height + by * 2 };
}

export function pointInBounds(p: Point, b: Bounds, margin = 0): boolean {
  return (
    p.x >= b.x - margin &&
    p.x <= b.x + b.width + margin &&
    p.y >= b.y - margin &&
    p.y <= b.y + b.height + margin
  );
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
