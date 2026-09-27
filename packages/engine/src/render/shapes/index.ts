import type { Element } from "@penpaper/shared";
import type { Theme } from "../theme";
import { dashArray, type Drawable, type RoughCache } from "../rough-cache";
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
      // Shading is its own texture; a dashed outline must not dash the hatches.
      ctx.setLineDash([]);
      ctx.fillStyle = el.backgroundColor;
      ctx.fill();
    } else {
      // Rough stores the dash pattern in the drawable, but these ops are
      // painted by hand, so the pattern has to be applied here.
      ctx.setLineDash(dashArray(el));
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      ctx.stroke();
    }
  }

  ctx.setLineDash([]);
}

/**
 * The two default inks. A board drawn in light mode carries near-black ink;
 * painting it on the dark theme unchanged would make every stroke disappear.
 * The mapping happens at paint time only, so the stored colour, exports in the
 * other theme, and collaboration data are untouched.
 */
const DEFAULT_INKS: ReadonlySet<string> = new Set(["#1e1e1e", "#e3e3e8"]);

function themedInk(el: Element, theme: Theme): Element {
  if (!DEFAULT_INKS.has(el.strokeColor) || el.strokeColor === theme.stroke) return el;
  return { ...el, strokeColor: theme.stroke };
}

/**
 * Draws one element in scene space. Assumes the caller has already applied the
 * camera transform.
 */
export function drawElement(
  ctx: CanvasRenderingContext2D,
  element: Element,
  cache: RoughCache,
  theme: Theme,
): void {
  const el = themedInk(element, theme);
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
