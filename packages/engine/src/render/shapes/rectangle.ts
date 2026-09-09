import type { Element } from "@penpaper/shared";
import type { Generator } from "../rough-cache";
import type { Options } from "roughjs/bin/core";

export function rectangleDrawable(gen: Generator, el: Element, options: Options) {
  return gen.rectangle(0, 0, Math.max(1, el.width), Math.max(1, el.height), options);
}
