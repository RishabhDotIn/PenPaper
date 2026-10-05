import type { Point } from "@penpaper/shared";

/**
 * Polygonal shapes: the ones that are "a list of corners" rather than a
 * rectangle, an ellipse, a stroke, or text.
 *
 * The point list lives here, in one place, because two consumers need the same
 * silhouette: the renderer turns it into a rough.js path, and the hit tester
 * asks whether a click landed inside it. Duplicating the maths in both places
 * is how "clicking the tip of a star does nothing" bugs get born.
 */
export type PolygonShape = "triangle" | "hexagon" | "star";

const POLYGON_SHAPES: ReadonlySet<string> = new Set<PolygonShape>([
  "triangle",
  "hexagon",
  "star",
]);

export function isPolygonShape(type: string): type is PolygonShape {
  return POLYGON_SHAPES.has(type);
}

/** Five-pointed star, alternating outer and inner radius. */
const STAR_POINTS = 5;
const STAR_INNER_RATIO = 0.42;

/**
 * The corners of a polygon, in a `0 0 width height` box, clockwise from the
 * top. Sized in one pass so resizing never changes the shape's character.
 */
export function polygonPoints(
  type: PolygonShape,
  width: number,
  height: number,
): Point[] {
  const w = Math.max(1, width);
  const h = Math.max(1, height);

  switch (type) {
    case "triangle":
      return [
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];

    case "hexagon":
      // Flat top and bottom, pointed left and right: it reads as a hexagon
      // even at 18 px, where a pointy-top one turns into a blob.
      return [
        { x: w * 0.25, y: 0 },
        { x: w * 0.75, y: 0 },
        { x: w, y: h / 2 },
        { x: w * 0.75, y: h },
        { x: w * 0.25, y: h },
        { x: 0, y: h / 2 },
      ];

    case "star": {
      const cx = w / 2;
      const cy = h / 2;
      const points: Point[] = [];
      for (let i = 0; i < STAR_POINTS * 2; i += 1) {
        const outer = i % 2 === 0;
        // Start at the top and walk clockwise: a star that starts on a flat
        // edge looks tilted in its box.
        const angle = -Math.PI / 2 + (i * Math.PI) / STAR_POINTS;
        const ratio = outer ? 1 : STAR_INNER_RATIO;
        points.push({
          x: cx + Math.cos(angle) * (w / 2) * ratio,
          y: cy + Math.sin(angle) * (h / 2) * ratio,
        });
      }
      return points;
    }
  }
}

/** Ray casting: true when the point is inside the closed polygon. */
export function pointInPolygon(points: readonly Point[], point: Point): boolean {
  if (points.length < 3) return false;

  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]!;
    const b = points[j]!;
    const crosses = a.y > point.y !== b.y > point.y;
    if (!crosses) continue;

    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from a point to the nearest edge, used for unfilled shapes. */
export function distanceToPolygon(points: readonly Point[], point: Point): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    best = Math.min(best, distanceToSegment(point, a, b));
  }
  return best;
}
