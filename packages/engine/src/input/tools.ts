import type { ElementType } from "@penpaper/shared";

export type Tool =
  | "select"
  | "hand"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "triangle"
  | "hexagon"
  | "star"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "laser"
  | "eraser";

/** Tools whose pointer-down starts a new element. */
export const SHAPE_TOOLS: Record<string, ElementType> = {
  rectangle: "rectangle",
  ellipse: "ellipse",
  diamond: "diamond",
  triangle: "triangle",
  hexagon: "hexagon",
  star: "star",
  arrow: "arrow",
  line: "line",
  freedraw: "freedraw",
  text: "text",
};

/**
 * Every tool's key, first match wins for the label shown in the UI.
 *
 * The letter aliases come first for the geometry shapes: the palette has to
 * name one key per row, and a mnemonic reads better there than a digit that
 * only exists because the six shapes happen to be first in the dock. The
 * digits still work — they are what the fistful of shape keys was — but the
 * dock tooltip and the palette now advertise the same letter.
 */
export const TOOL_SHORTCUTS: Record<string, Tool> = {
  r: "rectangle",
  d: "diamond",
  o: "ellipse",
  t: "triangle",
  g: "hexagon",
  s: "star",
  "1": "select",
  "2": "rectangle",
  "3": "diamond",
  "4": "ellipse",
  "5": "arrow",
  "6": "line",
  "7": "freedraw",
  "8": "text",
  "9": "eraser",
  h: "hand",
  v: "select",
  l: "laser",
};

export const TOOL_LABELS: Record<Tool, string> = {
  select: "Selection",
  hand: "Hand",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
  triangle: "Triangle",
  hexagon: "Hexagon",
  star: "Star",
  arrow: "Arrow",
  line: "Line",
  freedraw: "Draw",
  text: "Text",
  laser: "Laser pointer",
  eraser: "Eraser",
};

export function isShapeTool(tool: Tool): boolean {
  return tool in SHAPE_TOOLS;
}

/**
 * The one key to print next to a tool.
 *
 * A tool may answer to both a mnemonic and a digit (`r` and `2` both draw a
 * rectangle). The UI must show one, and a mnemonic beats a digit: the six
 * shapes sit in one menu now, so "Rectangle R / Triangle T" reads as a family,
 * where "Rectangle 2 / Triangle —" reads as three finished rows and three
 * unfinished ones.
 *
 * Object key order cannot answer this: integer-like keys are enumerated before
 * string keys no matter how the literal is written.
 */
export function toolShortcut(tool: Tool): string | null {
  let letter: string | null = null;
  let digit: string | null = null;

  for (const [key, bound] of Object.entries(TOOL_SHORTCUTS)) {
    if (bound !== tool) continue;
    if (/^[a-z]$/.test(key)) letter ??= key;
    else if (/^\d$/.test(key)) digit ??= key;
  }

  return (letter ?? digit)?.toUpperCase() ?? null;
}
