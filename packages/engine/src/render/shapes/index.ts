import type { Element } from "@penpaper/shared";
import type { Theme } from "../theme";
import type { Drawable, RoughCache } from "../rough-cache";
import { drawArrowheads } from "./arrow";
import { drawFreedraw } from "./freedraw";
import { drawText } from "./text";

export { wrapText, textFont, FONT_STACKS, MIN_TEXT_WIDTH } from "./text";
export { drawFreedraw, freedrawOutline } from "./freedraw";
export { drawArrowheads } from "./arrow";

interface DrawableOp {
  op: "move" | "line" | "bcurveTo";
  data: number[];
}

interface DrawableSet {
  type: "path" | "fillPath" | "fillSketch";
  ops: DrawableOp[];
}

/**
 * Rough.js gives us geometry, not painting: drawing the ops ourselves keeps
 * the renderer free of a `RoughCanvas` bound to one canvas element, which is
 * what makes shapes drawable into transform-stacked, offscreen, or fake
 * contexts.
 */
export function renderDrawable(
  ctx: CanvasRenderingContext2D,
  drawable: Drawable,
  el: Element,
): void {
  const sets = (drawable as unknown as { sets?: DrawableSet[] }).sets;
  if (!sets) return;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const set of sets) {
    ctx.beginPath();

    for (const op of set.ops) {
      const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = op.data;
      if (op.op === "move") ctx.moveTo(a, b);
      else if (op.op === "line") ctx.lineTo(a, b);
      else ctx.bezierCurveTo(a, b, c, d, e, f);
    }

    if (set.type === "fillPath" || set.type === "fillSketch") {
      ctx.fillStyle = el.backgroundColor;
      ctx.fill();
    } else {
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      ctx.stroke();
    }
  }
}

/**
 * Draws one element in scene space. Assumes the caller has already applied the
 * camera transform.
 */
export function drawElement(
  ctx: CanvasRenderingContext2D,
  el: Element,
  cache: RoughCache,
  theme: Theme,
): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, el.opacity / 100));

  // Rotate about the box centre, then work in local 0..width / 0..height
  // coordinates, which is what every shape generator expects.
  ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
  if (el.angle !== 0) ctx.rotate(el.angle);
  ctx.translate(-el.width / 2, -el.height / 2);

  switch (el.type) {
    case "freedraw":
      drawFreedraw(ctx, el);
      break;

    case "text":
      drawText(ctx, el, theme.text);
      break;

    case "arrow":
      renderDrawable(ctx, cache.get(el), el);
      drawArrowheads(ctx, el);
      break;

    default:
      renderDrawable(ctx, cache.get(el), el);
      break;
  }

  ctx.restore();
}
