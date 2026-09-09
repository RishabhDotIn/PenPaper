import type { Element } from "@penpaper/shared";
import type { Generator } from "../rough-cache";
import type { Options } from "roughjs/bin/core";
import { linePoints } from "./line";

export const ARROW_HEAD_ANGLE = Math.PI / 7;
export const ARROW_HEAD_LENGTH = 14;

export function arrowDrawable(gen: Generator, el: Element, options: Options) {
  return gen.linearPath(linePoints(el), options);
}

/** Two strokes at the tip, sized from stroke width and clamped for legibility. */
export function drawArrowheads(ctx: CanvasRenderingContext2D, el: Element): void {
  const points = linePoints(el);
  if (points.length < 2) return;

  const tip = points[points.length - 1];
  const previous = points[points.length - 2];
  if (!tip || !previous) return;

  const angle = Math.atan2(tip[1] - previous[1], tip[0] - previous[0]);
  const length = Math.max(ARROW_HEAD_LENGTH, el.strokeWidth * 5);

  if (el.endArrowhead !== "none") {
    drawHead(ctx, tip, angle, length, el.endArrowhead, el.strokeColor, el.strokeWidth);
  }

  if (el.startArrowhead !== "none") {
    const start = points[0];
    const after = points[1];
    if (start && after) {
      const startAngle = Math.atan2(start[1] - after[1], start[0] - after[0]);
      drawHead(ctx, start, startAngle, length, el.startArrowhead, el.strokeColor, el.strokeWidth);
    }
  }
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  tip: readonly [number, number],
  angle: number,
  length: number,
  kind: "arrow" | "dot",
  stroke: string,
  strokeWidth: number,
): void {
  if (kind === "dot") {
    ctx.beginPath();
    ctx.arc(tip[0], tip[1], Math.max(2, strokeWidth * 1.5), 0, Math.PI * 2);
    ctx.fillStyle = stroke;
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  for (const offset of [-ARROW_HEAD_ANGLE, ARROW_HEAD_ANGLE]) {
    ctx.lineTo(
      tip[0] - length * Math.cos(angle + offset),
      tip[1] - length * Math.sin(angle + offset),
    );
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}
