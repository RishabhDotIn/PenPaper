import type { Element, Point } from "@penpaper/shared";
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

const EDGE_HANDLES: ReadonlyArray<readonly [Handle, number, number]> = [
  ["nw", -0.5, -0.5],
  ["n", 0, -0.5],
  ["ne", 0.5, -0.5],
  ["e", 0.5, 0],
  ["se", 0.5, 0.5],
  ["s", 0, 0.5],
  ["sw", -0.5, 0.5],
  ["w", -0.5, 0],
];

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

  for (const [handle, fx, fy] of EDGE_HANDLES) {
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
