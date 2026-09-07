/**
 * PenPaper canvas engine.
 *
 * Framework-agnostic on purpose: no React, no Next, no DOM access at module
 * scope. The React shell in `apps/web` drives this through explicit calls.
 */

export const ENGINE_VERSION = "0.1.0";

export { Scene } from "./scene/scene";
export { createElement } from "./scene/factory";
export { indexBetween } from "./scene/fractional-index";

export {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  panBy,
  sceneToScreen,
  screenToScene,
  zoomAt,
  type Camera,
} from "./math/camera";

export {
  boundsContain,
  boundsIntersect,
  elementBounds,
  expandBounds,
  pointInBounds,
  unionBounds,
} from "./math/bounds";

export { Quadtree } from "./math/quadtree";
export { hitTest, hitsElement } from "./math/hit-test";
