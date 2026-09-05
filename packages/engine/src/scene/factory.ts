import {
  DEFAULT_ELEMENT_STYLE,
  type Bounds,
  type Element,
  type ElementType,
} from "@penpaper/shared";

/**
 * Element construction.
 *
 * Every field is filled, even for types that ignore it. That keeps the shape
 * identical across the app, the JSON column, and the Yjs map, so nothing has to
 * guess whether a missing field means "default" or "not applicable".
 */

function createId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();

  // Older WebViews only have getRandomValues.
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/** A line or arrow starts as a horizontal segment the width of its box. */
function defaultPoints(type: ElementType, bounds: Bounds): number[][] {
  if (type === "line" || type === "arrow") {
    return [
      [0, 0],
      [bounds.width, bounds.height],
    ];
  }
  return [];
}

export function createElement(type: ElementType, at: Bounds, index: string): Element {
  const now = Date.now();
  const isArrow = type === "arrow";

  return {
    id: createId(),
    type,

    x: at.x,
    y: at.y,
    width: at.width,
    height: at.height,
    angle: 0,

    strokeColor: DEFAULT_ELEMENT_STYLE.strokeColor,
    backgroundColor: DEFAULT_ELEMENT_STYLE.backgroundColor,
    fillStyle: DEFAULT_ELEMENT_STYLE.fillStyle,
    strokeWidth: DEFAULT_ELEMENT_STYLE.strokeWidth,
    strokeStyle: DEFAULT_ELEMENT_STYLE.strokeStyle,
    roughness: DEFAULT_ELEMENT_STYLE.roughness,
    opacity: DEFAULT_ELEMENT_STYLE.opacity,

    seed: createSeed(),
    index,

    groupIds: [],
    isDeleted: false,

    version: 1,
    updatedAt: now,

    points: defaultPoints(type, at),
    simulatePressure: true,

    text: "",
    fontSize: DEFAULT_ELEMENT_STYLE.fontSize,
    fontFamily: DEFAULT_ELEMENT_STYLE.fontFamily,
    textAlign: DEFAULT_ELEMENT_STYLE.textAlign,
    verticalAlign: DEFAULT_ELEMENT_STYLE.verticalAlign,
    lineHeight: DEFAULT_ELEMENT_STYLE.lineHeight,

    startBinding: null,
    endBinding: null,
    startArrowhead: "none",
    endArrowhead: isArrow ? "arrow" : "none",
    elbowed: false,

    src: "",
  };
}
