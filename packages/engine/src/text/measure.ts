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

/**
 * A width estimate for places where no canvas exists.
 *
 * The controller resizes a text box after an edit; it runs in a browser but
 * also under Node in tests, and creating a canvas just to measure one line is
 * not worth it. 0.55 em is close to the average glyph width of both bundled
 * families, and the renderer re-wraps with real metrics anyway.
 */
export function estimateMeasure(fontSize: number): Measure {
  return (text) => text.length * fontSize * 0.55;
}

/** Line count that `drawText` will produce for this element. */
export function textLineCount(el: Element, measure: Measure = estimateMeasure(el.fontSize)): number {
  return wrapText(el.text, el.width, textFont(el), measure).length;
}

/** Height needed to show every wrapped line, with one line as the floor. */
export function textHeight(el: Element, measure: Measure = estimateMeasure(el.fontSize)): number {
  const lines = Math.max(1, textLineCount(el, measure));
  return lines * el.fontSize * el.lineHeight;
}
