/**
 * The element model.
 *
 * Deliberately a single flat interface rather than a discriminated union.
 * Three reasons, all load-bearing:
 *
 *  1. Collaboration merges at field level (design doc 7.4): a flat record maps
 *     one-to-one onto a `Y.Map` of fields, so two people editing the colour and
 *     the position of the same shape never clobber each other.
 *  2. Persistence is a JSON column; a flat object round-trips without a
 *     per-type serializer.
 *  3. Renderers read fields in the hot path. Narrowing a union 60 times a frame
 *     buys nothing and costs type ceremony.
 *
 * Type-specific fields are always present and simply ignored by other types.
 */

export type ElementType =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "image";

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FillStyle = "hachure" | "cross-hatch" | "solid";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type StrokeWidth = 1 | 2 | 4;
export type Roughness = 0 | 1 | 2;
export type FontFamily = "excalifont" | "nunito" | "mono";
export type TextAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";
export type Arrowhead = "none" | "arrow" | "dot";

export interface Binding {
  elementId: string;
  focus: number;
}

export interface Element {
  id: string;
  type: ElementType;

  /** Scene coordinates: top-left of the *unrotated* bounding box. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Radians, clockwise, about the centre of the unrotated box. */
  angle: number;

  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: StrokeWidth;
  strokeStyle: StrokeStyle;
  roughness: Roughness;
  /** 0–100. */
  opacity: number;

  /** rough.js determinism: same seed, same wobble, every repaint. */
  seed: number;

  /** Fractional z-order key. Lexicographic order is paint order. */
  index: string;

  groupIds: string[];
  isDeleted: boolean;

  /** Bumped on every local mutation. Drives conflict debugging and undo. */
  version: number;
  updatedAt: number;

  /**
   * Freedraw: `[x, y, pressure]` triples in scene units, relative to x/y.
   * Line and arrow: `[x, y]` pairs, relative to x/y.
   */
  points: number[][];
  simulatePressure: boolean;

  text: string;
  fontSize: number;
  fontFamily: FontFamily;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  lineHeight: number;

  startBinding: Binding | null;
  endBinding: Binding | null;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  elbowed: boolean;

  /** `data:` URL or remote URL. Empty string when the element has no image. */
  src: string;
}

/** Hard caps from the design doc: refuse the save, keep the board responsive. */
export const BOARD_LIMITS = {
  maxElements: 2_000,
  maxSerializedBytes: 2 * 1024 * 1024,
} as const;

export const DEFAULT_ELEMENT_STYLE = {
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "hachure",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  fontSize: 20,
  fontFamily: "excalifont",
  textAlign: "left",
  verticalAlign: "top",
  lineHeight: 1.25,
} as const satisfies Partial<Element>;
