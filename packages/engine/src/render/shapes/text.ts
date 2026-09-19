import type { Element } from "@penpaper/shared";
import { textFont, wrapText, type Measure } from "../../text/measure";

// Layout lives in `text/measure.ts`; re-exported here so the shape module stays
// the one import a renderer needs.
export { FONT_STACKS, MIN_TEXT_WIDTH, textFont, wrapText, type Measure } from "../../text/measure";

export function drawText(
  ctx: CanvasRenderingContext2D,
  el: Element,
  fallbackColor: string,
): void {
  const font = textFont(el);
  const measure: Measure = (text, f) => {
    ctx.font = f;
    return ctx.measureText(text).width;
  };

  const lines = wrapText(el.text, el.width, font, measure);
  const lineHeight = el.fontSize * el.lineHeight;

  ctx.font = font;
  ctx.fillStyle = el.strokeColor === "transparent" ? fallbackColor : el.strokeColor;
  ctx.textAlign = el.textAlign === "center" ? "center" : el.textAlign === "right" ? "right" : "left";
  ctx.textBaseline = "top";

  const anchorX = el.textAlign === "center" ? el.width / 2 : el.textAlign === "right" ? el.width : 0;

  let startY = 0;
  if (el.verticalAlign === "middle") {
    startY = (el.height - lines.length * lineHeight) / 2;
  } else if (el.verticalAlign === "bottom") {
    startY = el.height - lines.length * lineHeight;
  }

  lines.forEach((line, index) => {
    ctx.fillText(line, anchorX, startY + index * lineHeight);
  });
}
