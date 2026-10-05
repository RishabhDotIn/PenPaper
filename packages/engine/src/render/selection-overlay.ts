import type { Element, Point } from "@penpaper/shared";
import { elementBounds } from "../math/bounds";
import { sceneToScreen, type Camera } from "../math/camera";
import { polygonPoints } from "../math/polygon";
import { getHandles } from "../selection/handles";
import type { Theme } from "./theme";

export interface SelectionOverlayOptions {
  /** Handle diameter in screen pixels. */
  handleSize?: number;
  /** Selection colour for the box and handles. */
  color?: string;
}

/**
 * Pixels between the element and its selection outline.
 *
 * Without this gap the outline sits exactly on a thin stroke — a horizontal
 * freedraw or a straight arrow — and the 1 px selection line hides the very
 * thing the user just drew. Excalidraw leaves the same visual breathing room.
 */
export const SELECTION_PADDING = 4;

/**
 * The silhouette an element should be outlined with.
 *
 * A bounding box is right for box-shaped things. For an ellipse or a diamond it
 * draws a rectangle around empty corners; tracing the shape itself makes the
 * selection feel attached to what was drawn.
 */
type Silhouette =
  | { kind: "box" }
  | { kind: "ellipse" }
  | { kind: "polygon"; points: readonly Point[] };

const DIAMOND_OUTLINE: readonly Point[] = [
  { x: 0.5, y: 0 },
  { x: 1, y: 0.5 },
  { x: 0.5, y: 1 },
  { x: 0, y: 0.5 },
];

function silhouetteFor(el: Element): Silhouette {
  switch (el.type) {
    case "ellipse":
      return { kind: "ellipse" };
    case "diamond":
      return { kind: "polygon", points: DIAMOND_OUTLINE };
    case "triangle":
    case "hexagon":
    case "star":
      return { kind: "polygon", points: polygonPoints(el.type, 1, 1) };
    default:
      return { kind: "box" };
  }
}

/**
 * Drawn in screen space, after the camera transform has been popped.
 *
 * That is the whole trick behind handles that stay 9 px at 0.1× and at 30×:
 * the box is projected, not scaled.
 */
export function drawSelection(
  ctx: CanvasRenderingContext2D,
  elements: readonly Element[],
  camera: Camera,
  theme: Theme,
  options: SelectionOverlayOptions = {},
): void {
  if (elements.length === 0) return;

  const handleSize = options.handleSize ?? 9;
  const color = options.color ?? theme.selection;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  if (elements.length === 1) {
    drawSingle(ctx, elements[0]!, camera, color, handleSize);
  } else {
    drawGroupBox(ctx, elements, camera, theme);
  }

  ctx.restore();
}

function drawSingle(
  ctx: CanvasRenderingContext2D,
  el: Element,
  camera: Camera,
  color: string,
  handleSize: number,
): void {
  const handles = getHandles(el, camera, handleSize);

  const centre = sceneToScreen(camera, { x: el.x + el.width / 2, y: el.y + el.height / 2 });
  const halfW = (el.width / 2) * camera.zoom + SELECTION_PADDING;
  const halfH = (el.height / 2) * camera.zoom + SELECTION_PADDING;
  const cos = Math.cos(el.angle);
  const sin = Math.sin(el.angle);

  /** A point in the element's normalized box (-0.5…0.5) to screen space. */
  const project = (nx: number, ny: number): Point => ({
    x: centre.x + nx * 2 * halfW * cos - ny * 2 * halfH * sin,
    y: centre.y + nx * 2 * halfW * sin + ny * 2 * halfH * cos,
  });

  const silhouette = silhouetteFor(el);

  if (silhouette.kind === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(centre.x, centre.y, halfW, halfH, el.angle, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const points =
      silhouette.kind === "polygon"
        ? silhouette.points.map((point) => project(point.x - 0.5, point.y - 0.5))
        : (
            [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, 1],
            ] as const
          ).map(([sx, sy]) => ({
            x: centre.x + sx * halfW * cos - sy * halfH * sin,
            y: centre.y + sx * halfW * sin + sy * halfH * cos,
          }));

    // The outline follows the element's rotation; an axis-aligned box around a
    // rotated rectangle puts its edges in the wrong place and makes the corner
    // handles look detached from it.
    const first = points[0];
    if (first) {
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // The rotation stem starts at the top of the element's own box, not at a
  // handle: a hexagon has two top handles and neither is the centre line.
  const top = project(0, -0.5);
  const rotation = handles.find((entry) => entry.handle === "rotation")?.point;
  if (rotation) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(rotation.x, rotation.y);
    ctx.stroke();
    ctx.restore();
  }

  for (const { point } of handles) {
    // Circles, not squares: they read as handles at any zoom and survive
    // fractional device pixel ratios without looking blurry.
    ctx.beginPath();
    ctx.arc(point.x, point.y, handleSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}

function drawGroupBox(
  ctx: CanvasRenderingContext2D,
  elements: readonly Element[],
  camera: Camera,
  theme: Theme,
): void {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const el of elements) {
    const b = elementBounds(el);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  const topLeft = sceneToScreen(camera, { x: minX, y: minY });
  const bottomRight = sceneToScreen(camera, { x: maxX, y: maxY });

  ctx.save();
  ctx.fillStyle = theme.selectionFill;
  ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  ctx.restore();

  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(
    Math.round(topLeft.x) + 0.5,
    Math.round(topLeft.y) + 0.5,
    Math.round(bottomRight.x - topLeft.x),
    Math.round(bottomRight.y - topLeft.y),
  );
  ctx.restore();
}
/** A live selection rectangle while dragging on empty canvas. */
export function drawMarquee(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  theme: Theme,
): void {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);

  ctx.save();
  ctx.fillStyle = theme.selectionFill;
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, width, height);
  ctx.restore();
}
