import type { Bounds } from "@penpaper/shared";

export interface BackingSize {
  width: number;
  height: number;
  /** The ratio actually used, after capping. */
  dpr: number;
}

/**
 * Canvas backing-store size for a CSS box and a device pixel ratio.
 *
 * The cap matters more than it looks. A 3× phone at 390×844 allocates
 * 3.0 Mpx; at 2× it allocates 1.3 Mpx, and the difference is visible as
 * dropped frames on a long stroke, not as a crispness win anyone can see at
 * arm's length. Tier C devices cap at 1.5.
 */
export function computeBackingSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxDpr = 2,
): BackingSize {
  const safeW = Number.isFinite(cssWidth) ? Math.max(0, cssWidth) : 0;
  const safeH = Number.isFinite(cssHeight) ? Math.max(0, cssHeight) : 0;
  const requested = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const dpr = Math.min(requested, maxDpr);

  return {
    width: Math.round(safeW * dpr),
    height: Math.round(safeH * dpr),
    dpr,
  };
}

/** The scene-space rectangle currently visible, used for culling. */
export function visibleBounds(
  camera: { x: number; y: number; zoom: number },
  viewport: { width: number; height: number },
  margin = 0,
): Bounds {
  const width = viewport.width / camera.zoom;
  const height = viewport.height / camera.zoom;
  return {
    x: -camera.x / camera.zoom - margin,
    y: -camera.y / camera.zoom - margin,
    width: width + margin * 2,
    height: height + margin * 2,
  };
}
