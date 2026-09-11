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

export { computeBackingSize, visibleBounds, type BackingSize } from "./render/surface";

export { Renderer, type RendererOptions, type RenderStats } from "./render/renderer";
export { RoughCache } from "./render/rough-cache";
export { drawElement } from "./render/shapes";
export { createStaticLayer, type StaticLayer } from "./render/static-layer";
export { darkTheme, lightTheme, type Theme } from "./render/theme";

export { InputController, type ControllerDeps } from "./input/controller";
export { InteractionFSM, type InteractionState } from "./input/fsm";
export { GestureArbiter } from "./input/gestures";
export { PalmRejection } from "./input/palm";
export type { PointerInput, PointerKind, WheelInput } from "./input/pointer";
export {
  SHAPE_TOOLS,
  TOOL_LABELS,
  TOOL_SHORTCUTS,
  isShapeTool,
  type Tool,
} from "./input/tools";
