import type { Bounds, Element, Point } from "@penpaper/shared";
import type { Scene } from "../scene/scene";
import { distanceToPolygon, pointInPolygon, polygonPoints } from "./polygon";
import type { Quadtree } from "./quadtree";

/**
 * Pointer-to-element resolution.
 *
 * Two stages on purpose: the quadtree narrows thousands of elements down to a
 * handful using cheap box maths, then each candidate gets an exact shape test.
 * That keeps a click on a crowded board independent of board size.
 */

/** Screen-space tolerance before dividing by zoom, in CSS pixels. */
const DEFAULT_TOLERANCE = 8;

function toLocal(el: Element, point: Point): Point {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;

  if (el.angle === 0) return { x: dx, y: dy };

  const cos = Math.cos(-el.angle);
  const sin = Math.sin(-el.angle);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

function hasFill(el: Element): boolean {
  return el.backgroundColor !== "transparent" && el.backgroundColor !== "";
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Exact test in the element's own, unrotated coordinate space. */
export function hitsElement(el: Element, point: Point, tolerance = DEFAULT_TOLERANCE): boolean {
  const local = toLocal(el, point);
  const halfW = el.width / 2;
  const halfH = el.height / 2;
  const pad = tolerance + el.strokeWidth / 2;

  switch (el.type) {
    case "rectangle":
    case "image":
    case "text":
      return Math.abs(local.x) <= halfW + pad && Math.abs(local.y) <= halfH + pad;

    case "ellipse": {
      const rx = halfW + pad;
      const ry = halfH + pad;
      if (rx <= 0 || ry <= 0) return false;
      const normalized = (local.x / rx) ** 2 + (local.y / ry) ** 2;
      if (normalized > 1) return false;
      if (hasFill(el)) return true;

      // Unfilled: only the ring itself is clickable, not the hole.
      const innerRx = Math.max(0, halfW - pad);
      const innerRy = Math.max(0, halfH - pad);
      const inner = innerRx > 0 && innerRy > 0
        ? (local.x / innerRx) ** 2 + (local.y / innerRy) ** 2
        : Number.POSITIVE_INFINITY;
      return inner > 1;
    }

    case "diamond": {
      const rx = halfW + pad;
      const ry = halfH + pad;
      if (rx <= 0 || ry <= 0) return false;
      const normalized = Math.abs(local.x) / rx + Math.abs(local.y) / ry;
      if (normalized > 1) return false;
      if (hasFill(el)) return true;

      const innerRx = Math.max(0, halfW - pad);
      const innerRy = Math.max(0, halfH - pad);
      const inner = innerRx > 0 && innerRy > 0
        ? Math.abs(local.x) / innerRx + Math.abs(local.y) / innerRy
        : Number.POSITIVE_INFINITY;
      return inner > 1;
    }

    case "triangle":
    case "hexagon":
    case "star": {
      const points = polygonPoints(el.type, el.width, el.height);
      // Hit testing works in the element's unrotated box, whose origin is the
      // top-left; the polygon table is already in those coordinates.
      const p = { x: local.x + halfW, y: local.y + halfH };
      if (hasFill(el) && pointInPolygon(points, p)) return true;
      // Unfilled: only the outline is clickable, so the hole in a star is not.
      return distanceToPolygon(points, p) <= pad;
    }

    case "line":
    case "arrow": {
      const points = el.points;
      if (points.length < 2) return false;

      // Points are relative to the element's top-left corner.
      const p = { x: local.x + halfW, y: local.y + halfH };
      for (let i = 1; i < points.length; i += 1) {
        const from = points[i - 1];
        const to = points[i];
        if (!from || !to) continue;
        const a = { x: from[0] ?? 0, y: from[1] ?? 0 };
        const b = { x: to[0] ?? 0, y: to[1] ?? 0 };
        if (distanceToSegment(p, a, b) <= pad) return true;
      }
      return false;
    }

    case "freedraw":
      // Pressure points are dense; the bounding box is indistinguishable in
      // practice and far cheaper than segment tests on every sample.
      return Math.abs(local.x) <= halfW + pad && Math.abs(local.y) <= halfH + pad;

    default:
      return false;
  }
}

/**
 * The topmost element under a point, or null.
 *
 * `tolerance` is in scene units, so callers divide screen tolerance by zoom
 * before calling this.
 */
export function hitTest(
  scene: Scene,
  tree: Quadtree,
  point: Point,
  tolerance = DEFAULT_TOLERANCE,
): string | null {
  const area: Bounds = {
    x: point.x - tolerance,
    y: point.y - tolerance,
    width: tolerance * 2,
    height: tolerance * 2,
  };

  const candidates: Element[] = [];
  for (const id of tree.query(area)) {
    const el = scene.get(id);
    if (el && !el.isDeleted) candidates.push(el);
  }

  // Highest index is painted last, so it is the one the user sees on top.
  candidates.sort((a, b) => (a.index < b.index ? 1 : a.index > b.index ? -1 : 0));

  for (const el of candidates) {
    if (hitsElement(el, point, tolerance)) return el.id;
  }

  return null;
}
