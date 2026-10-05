import type { Element, Point } from "@penpaper/shared";
import {
  LASER_FADE_MS,
  LASER_MAX_POINTS,
  LASER_MIN_STEP,
  laserClock,
  type LaserPoint,
} from "../laser";
import { boundsIntersect, elementBounds } from "../math/bounds";
import { panBy, sceneToScreen, screenToScene, zoomAt, type Camera } from "../math/camera";
import { type History } from "../history/history";
import { textHeight } from "../text/measure";
import { createElement } from "../scene/factory";
import { indexBetween } from "../scene/fractional-index";
import type { Scene } from "../scene/scene";
import { getHandles, handleAt, type Handle } from "../selection/handles";
import { resizeElement, rotateElement } from "../selection/transform";
import { InteractionFSM, type InteractionState } from "./fsm";
import { GestureArbiter } from "./gestures";
import { PalmRejection } from "./palm";
import type { PointerInput, WheelInput } from "./pointer";
import { isShapeTool, type Tool } from "./tools";

export interface ControllerDeps {
  scene: Scene;
  camera?: Camera;
  viewport?: { width: number; height: number };
  /** Screen-space hit test, in CSS pixels. The controller divides by zoom. */
  hitTest?(point: Point, tolerance: number): string | null;
  onCameraChange?(camera: Camera): void;
  onSceneChange?(): void;
  onSelectionChange?(ids: string[]): void;
  onRender?(): void;
  /** Fired when a text element is created and needs an editing overlay. */
  onCreateText?(element: Element): void;
  /** Undo/redo target. Omitted in tests that do not care about history. */
  history?: History;
}

/**
 * The style controls that apply to *new* elements.
 *
 * Positional and identity fields are excluded on purpose: a style is something
 * the user picks once and the tool stamps onto the next shape, not a way to
 * clone an element.
 */
export type StyleDefaults = Partial<
  Pick<
    Element,
    | "strokeColor"
    | "backgroundColor"
    | "fillStyle"
    | "strokeWidth"
    | "strokeStyle"
    | "roughness"
    | "opacity"
    | "fontSize"
    | "fontFamily"
    | "textAlign"
    | "verticalAlign"
    | "lineHeight"
    | "startArrowhead"
    | "endArrowhead"
  >
>;

const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const MIN_DRAG_SCENE = 4;
const DEFAULT_SHAPE_SIZE = 100;
const DEFAULT_HIT_TOLERANCE = 8;

interface Draft {
  id: string;
  origin: Point;
  /** Absolute scene points, for freedraw and for normalising line endpoints. */
  points: Point[];
  last: Point;
}

export class InputController {
  private readonly fsm = new InteractionFSM("idle");
  private readonly arbiter = new GestureArbiter();
  private readonly palm = new PalmRejection();
  private readonly scene: Scene;

  private camera: Camera;
  private tool: Tool = "select";
  private draft: Draft | null = null;
  private selected = new Set<string>();
  private style: StyleDefaults = {};

  /** Captured on pointer-down so every move is computed from the original. */
  private transformStart: { element: Element; handle: Handle } | null = null;

  /** The live laser trail. Never added to the scene and never saved. */
  private laserPoints: LaserPoint[] = [];

  private marqueeStart: Point | null = null;
  private marqueeRect: { x: number; y: number; width: number; height: number } | null = null;
  private marqueeAdditive = false;

  private lastScene: Point = { x: 0, y: 0 };
  private lastScreen: Point = { x: 0, y: 0 };
  private pinchLast: { distance: number; midpoint: Point } | null = null;

  constructor(private readonly deps: ControllerDeps) {
    this.scene = deps.scene;
    this.camera = deps.camera ?? DEFAULT_CAMERA;
  }

  get state(): InteractionState {
    return this.fsm.state;
  }

  get activeTool(): Tool {
    return this.tool;
  }

  get selection(): string[] {
    return [...this.selected];
  }

  /** Live elements in paint order, which is what the overlay draws. */
  get selectedElements(): Element[] {
    if (this.selected.size === 0) return [];
    return this.scene.ordered().filter((element) => this.selected.has(element.id));
  }

  /** Marquee in scene coordinates, or null when no box is being dragged. */
  get marquee(): { x: number; y: number; width: number; height: number } | null {
    return this.marqueeRect;
  }

  /**
   * Scene points of the laser gesture, oldest first.
   *
   * A fresh array on every change: the renderer compares by reference, and a
   * mutated array would leave the last segment unpainted.
   */
  get laserTrail(): readonly LaserPoint[] {
    return this.laserPoints;
  }

  /** Whether another frame is still needed for the trail to finish fading. */
  laserActive(now = laserClock()): boolean {
    const newest = this.laserPoints[this.laserPoints.length - 1];
    return Boolean(newest && now - newest.t < LASER_FADE_MS + 80);
  }

  /** Drops the trail now, e.g. when the tool changes or the board is exported. */
  clearLaser(): void {
    if (this.laserPoints.length === 0) return;
    this.laserPoints = [];
    this.deps.onRender?.();
  }

  getCamera(): Camera {
    return this.camera;
  }

  setTool(tool: Tool): void {
    if (tool === this.tool) return;
    this.cancelStroke();
    this.transformStart = null;
    this.marqueeStart = null;
    this.marqueeRect = null;
    // A trail belongs to the tool that made it. Leaving it fading over the
    // next tool's work looks like a rendering bug.
    this.laserPoints = [];
    this.tool = tool;
    this.fsm.reset();
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
    this.deps.onCameraChange?.(camera);
    this.deps.onRender?.();
  }

  /** Style applied to every element the tool creates from now on. */
  setStyle(style: StyleDefaults): void {
    this.style = { ...style };
  }

  getStyle(): StyleDefaults {
    return { ...this.style };
  }

  /** Tombstones every live element as one undoable step. */
  clearScene(): void {
    if (this.scene.size === 0) return;

    this.deps.history?.begin("clear");
    for (const element of this.scene.ordered()) this.scene.remove(element.id);
    this.selected.clear();
    this.draft = null;
    this.deps.history?.commit();

    this.deps.onSelectionChange?.([]);
    this.deps.onSceneChange?.();
    this.deps.onRender?.();
  }

  // ---------------------------------------------------------------- pointers

  pointerDown(e: PointerInput): void {
    if (!this.palm.accept({ type: e.type, time: Date.now() })) return;

    // A secondary click is a menu gesture everywhere else in the app. It used
    // to fall through to the armed tool and leave a stray shape behind.
    if (e.button !== undefined && e.button !== 0) return;

    const gesture = this.arbiter.pointerDown(e, Date.now());
    this.lastScreen = { x: e.x, y: e.y };

    if (gesture === "multi") {
      // A pinch always begins as an accidental stroke. Undo it, then gesture.
      this.cancelStroke();
      this.pinchLast = this.arbiter.pinch();
      return;
    }

    const point = screenToScene(this.camera, e);
    this.lastScene = point;

    // A handle on the current selection outranks the armed tool.
    //
    // Drawing a shape leaves it selected while the shape tool is still armed,
    // so the next press is usually on a corner: "make it bigger", not "draw
    // another one". Resizing must not cost a trip to the selection tool.
    if (
      this.tool !== "select" &&
      this.tool !== "hand" &&
      this.tool !== "eraser" &&
      this.tool !== "laser" &&
      this.beginHandleDrag(point, e)
    ) {
      return;
    }

    switch (this.tool) {
      case "hand":
        this.fsm.transition("panning");
        break;

      case "select":
        this.beginSelect(point, e);
        break;

      case "laser":
        this.laserPoints = [{ x: point.x, y: point.y, t: laserClock() }];
        this.fsm.transition("lasering");
        this.deps.onRender?.();
        break;

      case "eraser":
        this.deps.history?.begin("erase");
        this.fsm.transition("erasing");
        this.eraseAt(point);
        break;

      case "text":
        this.beginText(point);
        break;

      default:
        if (isShapeTool(this.tool)) this.beginDraw(point, e.pressure);
        break;
    }
  }

  pointerMove(e: PointerInput): void {
    const screenDelta = { x: e.x - this.lastScreen.x, y: e.y - this.lastScreen.y };
    this.lastScreen = { x: e.x, y: e.y };

    if (this.arbiter.active >= 2) {
      this.arbiter.pointerMove(e);
      this.updatePinch();
      return;
    }

    const point = screenToScene(this.camera, e);
    const sceneDelta = { x: point.x - this.lastScene.x, y: point.y - this.lastScene.y };
    this.lastScene = point;

    switch (this.fsm.state) {
      case "panning":
        this.setCamera(panBy(this.camera, screenDelta.x, screenDelta.y));
        break;

      case "drawing":
        this.updateDraft(point, e.pressure);
        break;

      case "dragging":
        this.translateSelection(sceneDelta, point);
        break;

      case "resizing":
      case "rotating":
        this.applyTransform(point, e);
        break;

      case "selecting":
        this.marqueeRect = this.marqueeStart ? boxFrom(this.marqueeStart, point) : null;
        this.deps.onRender?.();
        break;

      case "erasing":
        this.eraseAt(point);
        break;

      case "lasering":
        this.extendLaser(point);
        break;

      default:
        if (this.tool === "select") this.deps.onRender?.();
        break;
    }
  }

  pointerUp(e: PointerInput): void {
    this.arbiter.pointerUp(e);

    if (this.arbiter.active > 0) {
      this.pinchLast = this.arbiter.pinch();
      return;
    }

    this.pinchLast = null;

    if (this.fsm.state === "drawing") this.commitDraft();
    if (this.fsm.state === "selecting") this.commitMarquee();
    if (
      this.fsm.state === "dragging" ||
      this.fsm.state === "resizing" ||
      this.fsm.state === "rotating" ||
      this.fsm.state === "erasing"
    ) {
      this.deps.history?.commit();
      this.deps.onSceneChange?.();
    }

    this.draft = null;
    this.transformStart = null;
    this.marqueeStart = null;
    this.marqueeRect = null;
    this.fsm.reset();
    this.deps.onRender?.();
  }

  pointerCancel(): void {
    this.cancelStroke();
    this.cancelTransform();
    this.deps.history?.cancel();
    this.arbiter.reset();
    this.pinchLast = null;
    this.marqueeStart = null;
    this.marqueeRect = null;
    this.laserPoints = [];
    this.fsm.reset();
    this.deps.onRender?.();
  }

  // ------------------------------------------------------------------- wheel

  wheel(input: WheelInput): void {
    if (input.ctrl || input.meta) {
      const factor = Math.exp(-input.deltaY * 0.0025);
      this.setCamera(zoomAt(this.camera, { x: input.x, y: input.y }, factor));
      return;
    }

    if (input.shift) {
      this.setCamera(panBy(this.camera, -input.deltaY, 0));
      return;
    }

    this.setCamera(panBy(this.camera, -input.deltaX, -input.deltaY));
  }

  // -------------------------------------------------------------- selection

  setSelection(ids: string[]): void {
    this.selected = new Set(ids);
    this.deps.onSelectionChange?.(ids);
    this.deps.onRender?.();
  }

  /** Applies one style patch to every selected element, atomically. */
  patchSelection(patch: Partial<Element>): void {
    if (this.selected.size === 0) return;

    this.deps.history?.begin("style");
    for (const id of this.selected) {
      const element = this.scene.get(id);
      if (!element || element.isDeleted) continue;
      this.scene.update(id, patch);
    }
    this.deps.history?.commit();

    this.deps.onSceneChange?.();
    this.deps.onSelectionChange?.(this.selection);
    this.deps.onRender?.();
  }

  deleteSelection(): void {
    if (this.selected.size === 0) return;

    this.deps.history?.begin("delete");
    for (const id of this.selected) this.scene.remove(id);
    this.deps.history?.commit();

    this.setSelection([]);
    this.deps.onSceneChange?.();
  }

  /**
   * Commits text typed in the DOM overlay.
   *
   * The browser owns keystrokes, IME, and selection while an element is being
   * edited; the scene is updated once, as a single transaction, when editing
   * ends. An element left empty is deleted rather than persisted as a blank
   * box that can never be selected again.
   */
  setText(id: string, text: string): void {
    const element = this.scene.get(id);
    if (!element || element.type !== "text") return;
    // An unchanged non-empty value is a no-op; an unchanged *empty* value still
    // has to fall through so a text box dismissed before typing disappears.
    if (text === element.text && text.trim() !== "") return;

    this.deps.history?.begin("text");

    if (text.trim() === "") {
      this.scene.remove(id);
      this.setSelection([]);
    } else {
      // The renderer wraps with real canvas metrics; this estimate is close
      // enough to size the box without a second measuring pass per keystroke.
      const height = textHeight({ ...element, text });
      this.scene.update(id, { text, height });
      this.setSelection([id]);
    }

    this.deps.history?.commit();
    this.deps.onSceneChange?.();
    this.deps.onRender?.();
  }

  private beginSelect(point: Point, input: PointerInput): void {
    const shift = input.shift;

    // A handle belonging to the current single selection wins over the element
    // underneath it: clicking the corner of a selected box must resize, not
    // start dragging the box.
    if (this.beginHandleDrag(point, input)) return;

    const tolerance = DEFAULT_HIT_TOLERANCE / this.camera.zoom;
    const hit = this.deps.hitTest?.(point, tolerance) ?? null;

    if (hit) {
      if (shift) {
        const next = new Set(this.selected);
        if (next.has(hit)) next.delete(hit);
        else next.add(hit);
        this.setSelection([...next]);
      } else if (!this.selected.has(hit)) {
        // Clicking an element that is already part of a multi-selection keeps
        // the selection, so a group can be dragged as a unit.
        this.setSelection([hit]);
      }

      this.deps.history?.begin("move");
      this.fsm.transition("dragging");
      return;
    }

    if (!shift) this.setSelection([]);
    this.marqueeAdditive = shift;
    this.marqueeStart = point;
    this.marqueeRect = null;
    this.fsm.transition("selecting");
    this.deps.onRender?.();
  }

  /**
   * Starts a resize or rotation when the press landed on a handle.
   *
   * Shared by the selection tool and every other tool that can leave a shape
   * selected: the state machine only reaches a transform through `dragging`,
   * which also makes "pointer up during a resize" a single handled path.
   */
  private beginHandleDrag(point: Point, input: PointerInput): boolean {
    const current = this.selectedElements;
    const only = current.length === 1 ? current[0] : undefined;
    if (!only) return false;

    const screenPoint = sceneToScreen(this.camera, point);
    // Fingers get a 44 px target; a mouse pointer does not need one.
    const radius = input.type === "mouse" ? 8 : 22;
    const handle = handleAt(getHandles(only, this.camera), screenPoint, radius);
    if (!handle) return false;

    this.deps.history?.begin(handle === "rotation" ? "rotate" : "resize");
    this.fsm.transition("dragging");
    this.fsm.transition(handle === "rotation" ? "rotating" : "resizing");
    this.transformStart = { element: only, handle };
    this.deps.onRender?.();
    return true;
  }

  private commitMarquee(): void {
    const rect = this.marqueeRect;
    if (!rect) return;

    const ids = this.scene
      .ordered()
      .filter((element) => boundsIntersect(elementBounds(element), rect))
      .map((element) => element.id);

    if (this.marqueeAdditive) {
      const merged = new Set(this.selected);
      for (const id of ids) merged.add(id);
      this.setSelection([...merged]);
    } else {
      this.setSelection(ids);
    }
  }

  private applyTransform(point: Point, input: PointerInput): void {
    const start = this.transformStart;
    if (!start) return;

    const element = this.scene.get(start.element.id);
    if (!element) return;

    const patch =
      start.handle === "rotation"
        ? rotateElement(start.element, point, { snap: input.shift })
        : resizeElement(start.element, start.handle, point, {
            keepAspect: input.shift,
            fromCenter: input.alt,
          });

    if (Object.keys(patch).length === 0) return;

    this.scene.update(element.id, patch);
    this.deps.onRender?.();
  }

  private cancelTransform(): void {
    const start = this.transformStart;
    if (!start) return;

    const element = this.scene.get(start.element.id);
    if (element) {
      this.scene.update(element.id, {
        x: start.element.x,
        y: start.element.y,
        width: start.element.width,
        height: start.element.height,
        angle: start.element.angle,
      });
    }

    this.transformStart = null;
  }

  private translateSelection(delta: Point, point: Point): void {
    if (delta.x === 0 && delta.y === 0) return;

    for (const id of this.selected) {
      const el = this.scene.get(id);
      if (!el || el.isDeleted) continue;
      this.scene.update(id, { x: el.x + delta.x, y: el.y + delta.y });
    }

    this.lastScene = point;
    this.deps.onRender?.();
  }

  // ----------------------------------------------------------------- drawing

  /** Stamps the user's chosen style over the factory defaults. */
  private styled(element: Element): Element {
    return { ...element, ...this.style };
  }

  private topIndex(): string {
    const ordered = this.scene.ordered();
    const last = ordered[ordered.length - 1];
    return indexBetween(last?.index ?? null, null);
  }

  private beginDraw(point: Point, pressure: number): void {
    const type = this.tool as Element["type"];
    const element = this.styled(
      createElement(type, { x: point.x, y: point.y, width: 0, height: 0 }, this.topIndex()),
    );
    this.deps.history?.begin("draw");

    if (type === "freedraw") {
      element.points = [[0, 0, pressure]];
    } else if (type === "line" || type === "arrow") {
      element.points = [
        [0, 0],
        [0, 0],
      ];
    }

    this.scene.add(element);
    this.draft = { id: element.id, origin: point, points: [{ x: point.x, y: point.y }], last: point };
    this.fsm.transition("drawing");
    this.deps.onRender?.();
  }

  private updateDraft(point: Point, pressure: number): void {
    if (!this.draft) return;

    const el = this.scene.get(this.draft.id);
    if (!el) return;

    this.draft.points.push({ x: point.x, y: point.y });
    this.draft.last = point;

    if (el.type === "freedraw") {
      this.updateFreedraw(el, pressure);
      return;
    }

    const box = boxFrom(this.draft.origin, point);

    if (el.type === "line" || el.type === "arrow") {
      this.scene.update(el.id, {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        points: [
          [this.draft.origin.x - box.x, this.draft.origin.y - box.y],
          [point.x - box.x, point.y - box.y],
        ],
      });
    } else {
      this.scene.update(el.id, box);
    }

    this.deps.onRender?.();
  }

  private updateFreedraw(el: Element, pressure: number): void {
    if (!this.draft) return;

    const bounds = boundsOfPoints(this.draft.points);
    const points = this.draft.points.map((p) => [p.x - bounds.x, p.y - bounds.y, pressure]);
    const first = points[0];
    if (first) first[2] = pressure;

    this.scene.update(el.id, {
      x: bounds.x,
      y: bounds.y,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
      points,
    });
    this.deps.onRender?.();
  }

  private commitDraft(): void {
    if (!this.draft) return;

    const el = this.scene.get(this.draft.id);

    if (el) {
      if (el.type === "freedraw" && this.draft.points.length < 2) {
        this.scene.remove(el.id);
      } else if (el.width < MIN_DRAG_SCENE && el.height < MIN_DRAG_SCENE) {
        // A click with a shape tool means "give me a default shape", not
        // "give me a zero-sized one I can never grab".
        this.scene.update(el.id, {
          x: this.draft.origin.x,
          y: this.draft.origin.y,
          width: DEFAULT_SHAPE_SIZE,
          height: DEFAULT_SHAPE_SIZE,
        });
      } else {
        this.scene.update(el.id, {
          width: Math.max(1, el.width),
          height: Math.max(1, el.height),
        });
      }

      // A pen stroke is ink, not an object to transform. Selecting it would
      // put resize handles across fresh writing and point the style panel at
      // the stroke instead of the next one. Shapes still select, so they can
      // be moved or restyled straight after they are drawn.
      if (el.type !== "freedraw") this.setSelection([el.id]);
      this.deps.onSceneChange?.();
    }

    this.draft = null;
    this.deps.history?.commit();
  }

  private cancelStroke(): void {
    if (this.draft && this.fsm.state === "drawing") {
      this.scene.remove(this.draft.id);
      this.draft = null;
      this.deps.history?.cancel();
    }
  }

  // ------------------------------------------------------------------- text

  private beginText(point: Point): void {
    this.deps.history?.begin("text");
    const element = this.styled(
      createElement("text", { x: point.x, y: point.y, width: 200, height: 28 }, this.topIndex()),
    );
    this.scene.add(element);
    this.setSelection([element.id]);
    this.fsm.transition("editingText");
    this.deps.onCreateText?.(element);
    this.deps.onSceneChange?.();
    this.deps.history?.commit();
  }

  // ----------------------------------------------------------------- eraser

  private eraseAt(point: Point): void {
    const tolerance = DEFAULT_HIT_TOLERANCE / this.camera.zoom;
    const hit = this.deps.hitTest?.(point, tolerance) ?? null;
    if (!hit) return;

    this.scene.remove(hit);
    this.selected.delete(hit);
    this.deps.onSelectionChange?.(this.selection);
    this.deps.onSceneChange?.();
    this.deps.onRender?.();
  }

  // ------------------------------------------------------------------ laser

  private extendLaser(point: Point): void {
    const last = this.laserPoints[this.laserPoints.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < LASER_MIN_STEP) return;

    this.laserPoints = [...this.laserPoints, { x: point.x, y: point.y, t: laserClock() }].slice(
      -LASER_MAX_POINTS,
    );
    this.deps.onRender?.();
  }

  // ------------------------------------------------------------------ pinch

  private updatePinch(): void {
    const pinch = this.arbiter.pinch();
    if (!pinch || !this.pinchLast) {
      this.pinchLast = pinch;
      return;
    }

    const factor = pinch.distance / Math.max(1, this.pinchLast.distance);
    const movedBy = {
      x: pinch.midpoint.x - this.pinchLast.midpoint.x,
      y: pinch.midpoint.y - this.pinchLast.midpoint.y,
    };

    const zoomed = zoomAt(this.camera, pinch.midpoint, factor);
    this.setCamera(panBy(zoomed, movedBy.x, movedBy.y));
    this.pinchLast = pinch;
  }
}

function boxFrom(a: Point, b: Point) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function boundsOfPoints(points: Point[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
