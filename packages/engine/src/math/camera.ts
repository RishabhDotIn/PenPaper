import type { Point } from "@penpaper/shared";

/**
 * The camera is the only thing that maps scene space to screen space.
 *
 * `x`/`y` are the screen-space position of the scene origin, `zoom` is the
 * scale factor. Keeping it this small means a pan is one addition and the
 * renderer can switch to a canvas transform in one line.
 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

export function screenToScene(camera: Camera, p: Point): Point {
  return {
    x: (p.x - camera.x) / camera.zoom,
    y: (p.y - camera.y) / camera.zoom,
  };
}

export function sceneToScreen(camera: Camera, p: Point): Point {
  return {
    x: p.x * camera.zoom + camera.x,
    y: p.y * camera.zoom + camera.y,
  };
}

export function clampZoom(zoom: number, minZoom = MIN_ZOOM, maxZoom = MAX_ZOOM): number {
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}

/**
 * Zooms around a screen-space anchor and keeps whatever is under it pinned.
 *
 * A pinch, a wheel event, and the +/- buttons all go through here, so the
 * anchor behaviour cannot drift between input paths.
 */
export function zoomAt(
  camera: Camera,
  screenPoint: Point,
  factor: number,
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM,
): Camera {
  const zoom = clampZoom(camera.zoom * factor, minZoom, maxZoom);
  const anchored = screenToScene(camera, screenPoint);

  return {
    x: screenPoint.x - anchored.x * zoom,
    y: screenPoint.y - anchored.y * zoom,
    zoom,
  };
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}
