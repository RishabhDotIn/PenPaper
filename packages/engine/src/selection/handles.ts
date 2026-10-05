import type { Element, Point } from "@penpaper/shared";
import { polygonPoints } from "../math/polygon";
import { sceneToScreen, type Camera } from "../math/camera";

export type Handle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "rotation";

export interface HandlePoint {
  handle: Handle;
  /** Screen space, so the handle stays the same size at every zoom level. */
  point: Point;
}

/** One handle anchor, in fractions of the element box from its centre. */
interface HandleAnchor {
  handle: Handle;
  fx: number;
  fy: number;
}

/**
 * The default grid: corners and edge midpoints.
 *
 * Rectangles, lines, arrows, text, and freehand strokes share it because their
 * own geometry *is* a box. Ellipses, diamonds, and polygons do not: a dot at
 * the corner of a diamond's bounding box sits in empty space, which reads as a
 * handle that belongs to another shape.
 */
const BOX_ANCHORS: ReadonlyArray<readonly [Handle, number, number]> = [
  ["nw", -0.5, -0.5],
  ["n", 0, -0.5],
  ["ne", 0.5, -0.5],
  ["e", 0.5, 0],
  ["se", 0.5, 0.5],
  ["s", 0, 0.5],
  ["sw", -0.5, 0.5],
  ["w", -0.5, 0],
];

/** Cardinal points, which are exactly the diamond's and ellipse's extremes. */
const CARDINAL_ANCHORS: ReadonlyArray<readonly [Handle, number, number]> = [
  ["n", 0, -0.5],
  ["e", 0.5, 0],
  ["s", 0, 0.5],
  ["w", -0.5, 0],
];

function direction(fx: number, fy: number): Handle {
  const x = Math.abs(fx) < 1e-9 ? 0 : fx < 0 ? -1 : 1;
  const y = Math.abs(fy) < 1e-9 ? 0 : fy < 0 ? -1 : 1;

  if (y < 0) return x < 0 ? "nw" : x > 0 ? "ne" : "n";
  if (y > 0) return x < 0 ? "sw" : x > 0 ? "se" : "s";
  return x < 0 ? "w" : "e";
}

function anchor(fx: number, fy: number): HandleAnchor {
  return { handle: direction(fx, fy), fx, fy };
}

function polygonAnchors(type: "triangle" | "hexagon" | "star"): HandleAnchor[] {
  return polygonPoints(type, 1, 1)
    // A star has ten corners; the five inner ones would crowd the handles into
    // a ring of dots. The outer tips are the silhouette and the useful targets.
    .filter((_, index) => type !== "star" || index % 2 === 0)
    .map((point) => anchor(point.x - 0.5, point.y - 0.5));
}

/**
 * Handles sit on the shape, not on a rectangle drawn around it.
 *
 * Every anchor is still turned into one of the nine resize directions, so the
 * transform maths does not need a second code path: dragging a hexagon's top
 * edge resizes its height, exactly like dragging a rectangle's top edge.
 */
function anchorsFor(el: Element): HandleAnchor[] {
  switch (el.type) {
    case "diamond":
    case "ellipse":
      return CARDINAL_ANCHORS.map(([handle, fx, fy]) => ({ handle, fx, fy }));

    case "triangle":
    case "hexagon":
    case "star":
      return polygonAnchors(el.type);

    default:
      return BOX_ANCHORS.map(([handle, fx, fy]) => ({ handle, fx, fy }));
  }
}

/** Screen-space distance from the top edge to the rotation handle. */
export const ROTATION_HANDLE_OFFSET = 22;

/**
 * Handles in screen space.
 *
 * The alternative — scene-space handles — makes them vanish when zoomed out
 * and swamp a small shape when zoomed in. Screen space costs one transform per
 * handle and makes the touch target predictable.
 */
export function getHandles(el: Element, camera: Camera, _hitSize = 8): HandlePoint[] {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const cos = Math.cos(el.angle);
  const sin = Math.sin(el.angle);

  const handles: HandlePoint[] = [];

  for (const { handle, fx, fy } of anchorsFor(el)) {
    const lx = fx * el.width;
    const ly = fy * el.height;
    const world = { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
    handles.push({ handle, point: sceneToScreen(camera, world) });
  }

  // "Up" in the element's own frame, which rotates with it.
  const topWorld = {
    x: cx + (0 * cos - -el.height / 2 * sin),
    y: cy + (0 * sin + -el.height / 2 * cos),
  };
  const topScreen = sceneToScreen(camera, topWorld);

  handles.push({
    handle: "rotation",
    point: {
      x: topScreen.x + sin * ROTATION_HANDLE_OFFSET,
      y: topScreen.y - cos * ROTATION_HANDLE_OFFSET,
    },
  });

  return handles;
}

/** Nearest handle within `radius` screen pixels, or null. */
export function handleAt(
  handles: readonly HandlePoint[],
  screenPoint: Point,
  radius = 10,
): Handle | null {
  let best: Handle | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  // Iterate in reverse so the rotation handle, which can overlap a corner on
  // a very short element, wins the tie: `distance <` keeps the first entry
  // seen at a given distance, and the rotation handle is last in the list.
  for (let i = handles.length - 1; i >= 0; i -= 1) {
    const entry = handles[i];
    if (!entry) continue;
    const distance = Math.hypot(entry.point.x - screenPoint.x, entry.point.y - screenPoint.y);
    if (distance <= radius && distance < bestDistance) {
      bestDistance = distance;
      best = entry.handle;
    }
  }

  return best;
}

export function isCornerHandle(handle: Handle): boolean {
  return handle === "nw" || handle === "ne" || handle === "se" || handle === "sw";
}
