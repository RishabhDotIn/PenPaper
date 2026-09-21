import type { Element } from "@penpaper/shared";
import { elementBounds } from "../math/bounds";
import { sceneToScreen, type Camera } from "../math/camera";
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
  const byName = new Map(handles.map((entry) => [entry.handle, entry.point] as const));

  // The outline is drawn on a padded box rather than through the handles, so a
  // thin element is still visible while it is selected.
  const centre = sceneToScreen(camera, { x: el.x + el.width / 2, y: el.y + el.height / 2 });
  const halfW = (el.width / 2) * camera.zoom + SELECTION_PADDING;
  const halfH = (el.height / 2) * camera.zoom + SELECTION_PADDING;
  const cos = Math.cos(el.angle);
  const sin = Math.sin(el.angle);

  const corners = ([
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const).map(([sx, sy]) => ({
    x: centre.x + sx * halfW * cos - sy * halfH * sin,
    y: centre.y + sx * halfW * sin + sy * halfH * cos,
  }));

  // The outline follows the element's rotation; an axis-aligned box around a
  // rotated rectangle puts its edges in the wrong place and makes the corner
  // handles look detached from it.
  const first = corners[0];
  if (first) {
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (const corner of corners.slice(1)) ctx.lineTo(corner.x, corner.y);
    ctx.closePath();
    ctx.stroke();
  }

  const top = byName.get("n");
  const rotation = byName.get("rotation");
  if (top && rotation) {
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
