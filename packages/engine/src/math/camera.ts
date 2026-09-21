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

export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Centres a scene in the space the chrome leaves free.
 *
 * `insets` are the areas covered by fixed UI (the dock, the properties panel),
 * which is why this cannot be a symmetric padding: on a phone the bottom
 * belongs to the toolbar, on a desktop the right belongs to the panel.
 */
export function fitCamera(
  bounds: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  insets: ViewInsets = { top: 32, right: 32, bottom: 32, left: 32 },
  maxZoom = 1,
): Camera {
  const availableWidth = Math.max(1, viewport.width - insets.left - insets.right);
  const availableHeight = Math.max(1, viewport.height - insets.top - insets.bottom);

  const zoom = clampZoom(
    Math.min(
      maxZoom,
      availableWidth / Math.max(1, bounds.width),
      availableHeight / Math.max(1, bounds.height),
    ),
  );

  return {
    zoom,
    x: insets.left + (availableWidth - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: insets.top + (availableHeight - bounds.height * zoom) / 2 - bounds.y * zoom,
  };
}
