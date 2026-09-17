import type {
  Arrowhead,
  Binding,
  Element,
  ElementType,
  FillStyle,
  FontFamily,
  Roughness,
  StrokeStyle,
  StrokeWidth,
  TextAlign,
  VerticalAlign,
} from "@penpaper/shared";
import { createElement } from "./scene/factory";
import { Scene } from "./scene/scene";

/**
 * Persistence format.
 *
 * Deliberately a version number and a flat element array: the same shape a
 * Postgres `jsonb` column will hold later, and the same shape the collab
 * service will seed a room from. Nothing here knows about cameras, tools, or
 * React.
 */
export const SCENE_VERSION = 1;

export interface SceneSnapshot {
  version: typeof SCENE_VERSION;
  elements: Element[];
}

/**
 * Serializes live elements only.
 *
 * Tombstones matter for merging, not for reopening a board on the same device:
 * persisting them would grow the file forever, and there is no replica to
 * protect from a resurrection here.
 */
export function serializeScene(scene: Scene): string {
  const snapshot: SceneSnapshot = { version: SCENE_VERSION, elements: scene.ordered() };
  return JSON.stringify(snapshot);
}

/**
 * Accepts anything and repairs what it can.
 *
 * A board that was saved by an older build, or that lost a field to a partial
 * write, should open with its remaining elements rather than fail wholesale.
 * Anything structurally unreadable is dropped instead of being rendered as
 * `NaN` geometry.
 */
export function deserializeScene(json: string): Scene {
  const parsed: unknown = JSON.parse(json);

  if (!isRecord(parsed)) {
    throw new Error("PenPaper: board snapshot is not an object");
  }
  if (parsed.version !== SCENE_VERSION) {
    throw new Error(`PenPaper: unsupported board version ${String(parsed.version)}`);
  }
  if (!Array.isArray(parsed.elements)) {
    throw new Error("PenPaper: board snapshot has no elements array");
  }

  const scene = new Scene();
  for (const raw of parsed.elements) {
    const element = normalizeElement(raw);
    // A duplicate id would otherwise throw out of `Scene.add` and lose the
    // whole board; keeping the first copy matches "last write wins" badly, but
    // never discards unrelated elements.
    if (element && !scene.get(element.id)) scene.add(element);
  }

  return scene;
}

const ELEMENT_TYPES: ReadonlySet<string> = new Set<ElementType>([
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
  "freedraw",
  "text",
  "image",
]);

const FILL_STYLES: readonly FillStyle[] = ["hachure", "cross-hatch", "solid"];
const STROKE_WIDTHS: readonly StrokeWidth[] = [1, 2, 4];
const STROKE_STYLES: readonly StrokeStyle[] = ["solid", "dashed", "dotted"];
const ROUGHNESS: readonly Roughness[] = [0, 1, 2];
const FONT_FAMILIES: readonly FontFamily[] = ["excalifont", "nunito", "mono"];
const TEXT_ALIGNS: readonly TextAlign[] = ["left", "center", "right"];
const VERTICAL_ALIGNS: readonly VerticalAlign[] = ["top", "middle", "bottom"];
const ARROWHEADS: readonly Arrowhead[] = ["none", "arrow", "dot"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function oneOf<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizePoints(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];

  const points: number[][] = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2) continue;
    if (!point.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) {
      continue;
    }
    points.push(point as number[]);
  }
  return points;
}

function normalizeBinding(value: unknown): Binding | null {
  if (!isRecord(value)) return null;

  const elementId = value.elementId;
  const focus = value.focus;
  if (typeof elementId !== "string" || typeof focus !== "number" || !Number.isFinite(focus)) {
    return null;
  }

  return { elementId, focus };
}

function normalizeElement(raw: unknown): Element | null {
  if (!isRecord(raw)) return null;

  const type = raw.type;
  if (typeof type !== "string" || !ELEMENT_TYPES.has(type)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;

  const { x, y, width, height } = raw;
  for (const dimension of [x, y, width, height]) {
    if (typeof dimension !== "number" || !Number.isFinite(dimension)) return null;
  }
  if (typeof raw.index !== "string" || raw.index.length === 0) return null;

  // Defaults come from the factory so every field of the current schema is
  // filled in, including fields an older snapshot could not have written.
  const base = createElement(
    type as ElementType,
    { x: x as number, y: y as number, width: width as number, height: height as number },
    raw.index,
  );

  return {
    ...base,
    id: raw.id,
    type: type as ElementType,

    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
    angle: finite(raw.angle, base.angle),

    strokeColor: text(raw.strokeColor, base.strokeColor),
    backgroundColor: text(raw.backgroundColor, base.backgroundColor),
    fillStyle: oneOf(raw.fillStyle, FILL_STYLES, base.fillStyle),
    strokeWidth: oneOf(raw.strokeWidth, STROKE_WIDTHS, base.strokeWidth),
    strokeStyle: oneOf(raw.strokeStyle, STROKE_STYLES, base.strokeStyle),
    roughness: oneOf(raw.roughness, ROUGHNESS, base.roughness),
    opacity: clamp(finite(raw.opacity, base.opacity), 0, 100),

    seed: finite(raw.seed, base.seed),
    index: raw.index,

    groupIds: Array.isArray(raw.groupIds)
      ? raw.groupIds.filter((id): id is string => typeof id === "string")
      : [],
    // Snapshots only ever contain live elements; a stray tombstone is dropped
    // rather than persisted into the next generation.
    isDeleted: false,

    version: finite(raw.version, base.version),
    updatedAt: finite(raw.updatedAt, base.updatedAt),

    points: normalizePoints(raw.points),
    simulatePressure: bool(raw.simulatePressure, base.simulatePressure),

    text: text(raw.text, base.text),
    fontSize: finite(raw.fontSize, base.fontSize),
    fontFamily: oneOf(raw.fontFamily, FONT_FAMILIES, base.fontFamily),
    textAlign: oneOf(raw.textAlign, TEXT_ALIGNS, base.textAlign),
    verticalAlign: oneOf(raw.verticalAlign, VERTICAL_ALIGNS, base.verticalAlign),
    lineHeight: finite(raw.lineHeight, base.lineHeight),

    startBinding: normalizeBinding(raw.startBinding),
    endBinding: normalizeBinding(raw.endBinding),
    startArrowhead: oneOf(raw.startArrowhead, ARROWHEADS, base.startArrowhead),
    endArrowhead: oneOf(raw.endArrowhead, ARROWHEADS, base.endArrowhead),
    elbowed: bool(raw.elbowed, base.elbowed),

    src: text(raw.src, base.src),
  };
}
