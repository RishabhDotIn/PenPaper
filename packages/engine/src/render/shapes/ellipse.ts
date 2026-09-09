import type { Element } from "@penpaper/shared";
import type { Generator } from "../rough-cache";
import type { Options } from "roughjs/bin/core";

export function ellipseDrawable(gen: Generator, el: Element, options: Options) {
  const width = Math.max(1, el.width);
  const height = Math.max(1, el.height);
  return gen.ellipse(width / 2, height / 2, width, height, options);
}
