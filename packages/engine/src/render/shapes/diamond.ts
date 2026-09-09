import type { Element } from "@penpaper/shared";
import type { Generator } from "../rough-cache";
import type { Options } from "roughjs/bin/core";

export function diamondDrawable(gen: Generator, el: Element, options: Options) {
  const width = Math.max(1, el.width);
  const height = Math.max(1, el.height);
  const points: Array<[number, number]> = [
    [width / 2, 0],
    [width, height / 2],
    [width / 2, height],
    [0, height / 2],
    [width / 2, 0],
  ];
  return gen.polygon(points, options);
}
