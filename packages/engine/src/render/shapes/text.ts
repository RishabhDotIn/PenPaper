import type { Element, FontFamily } from "@penpaper/shared";

export const FONT_STACKS: Record<FontFamily, string> = {
  excalifont: "Excalifont, Segoe Print, Comic Sans MS, cursive",
  nunito: "Nunito, system-ui, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

export const MIN_TEXT_WIDTH = 24;

export type Measure = (text: string, font: string) => number;

/**
 * Greedy word wrap. Deliberately not a layout engine: it cannot break inside a
 * long word, which is why the text tool also resizes the box instead of
 * clipping.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  font: string,
  measure: Measure,
): string[] {
  const lines: string[] = [];
  const width = Math.max(MIN_TEXT_WIDTH, maxWidth);

  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (current === "" || measure(candidate, font) <= width) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current !== "") lines.push(current);
  }

  return lines;
}

export function textFont(el: Element): string {
  return `${el.fontSize}px ${FONT_STACKS[el.fontFamily]}`;
}

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
