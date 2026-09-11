import type { Element, Point } from "@penpaper/shared";
import { panBy, screenToScene, zoomAt, type Camera } from "../math/camera";
import { createElement } from "../scene/factory";
import { indexBetween } from "../scene/fractional-index";
import type { Scene } from "../scene/scene";
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
}

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

  getCamera(): Camera {
    return this.camera;
  }

  setTool(tool: Tool): void {
    if (tool === this.tool) return;
    this.cancelStroke();
    this.tool = tool;
    this.fsm.reset();
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
    this.deps.onCameraChange?.(camera);
    this.deps.onRender?.();
  }

  // ---------------------------------------------------------------- pointers

  pointerDown(e: PointerInput): void {
    if (!this.palm.accept({ type: e.type, time: Date.now() })) return;

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

    switch (this.tool) {
      case "hand":
        this.fsm.transition("panning");
        break;

      case "select":
        this.beginSelect(point);
        break;

      case "eraser":
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

      case "erasing":
        this.eraseAt(point);
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
    if (this.fsm.state === "dragging") this.deps.onSceneChange?.();

    this.draft = null;
    this.fsm.reset();
    this.deps.onRender?.();
  }

  pointerCancel(): void {
    this.cancelStroke();
    this.arbiter.reset();
    this.pinchLast = null;
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

  private beginSelect(point: Point): void {
    const tolerance = DEFAULT_HIT_TOLERANCE / this.camera.zoom;
    const hit = this.deps.hitTest?.(point, tolerance) ?? null;

    if (hit) {
      this.setSelection([hit]);
      this.fsm.transition("dragging");
      return;
    }

    this.setSelection([]);
    this.fsm.transition("selecting");
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

  private topIndex(): string {
    const ordered = this.scene.ordered();
    const last = ordered[ordered.length - 1];
    return indexBetween(last?.index ?? null, null);
  }

  private beginDraw(point: Point, pressure: number): void {
    const type = this.tool as Element["type"];
    const element = createElement(type, { x: point.x, y: point.y, width: 0, height: 0 }, this.topIndex());

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

      this.setSelection([el.id]);
      this.deps.onSceneChange?.();
    }

    this.draft = null;
  }

  private cancelStroke(): void {
    if (this.draft && this.fsm.state === "drawing") {
      this.scene.remove(this.draft.id);
      this.draft = null;
    }
  }

  // ------------------------------------------------------------------- text

  private beginText(point: Point): void {
    const element = createElement("text", { x: point.x, y: point.y, width: 200, height: 28 }, this.topIndex());
    this.scene.add(element);
    this.setSelection([element.id]);
    this.fsm.transition("editingText");
    this.deps.onCreateText?.(element);
    this.deps.onSceneChange?.();
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
