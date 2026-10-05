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

export const TOOL_SHORTCUTS: Record<string, Tool> = {
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
