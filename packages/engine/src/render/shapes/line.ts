import type { Element } from "@penpaper/shared";
import type { Generator } from "../rough-cache";
import type { Options } from "roughjs/bin/core";

export function linePoints(el: Element): Array<[number, number]> {
  if (el.points.length >= 2) {
    return el.points.map((p) => [p[0] ?? 0, p[1] ?? 0] as [number, number]);
  }
  return [
    [0, 0],
    [el.width, el.height],
  ];
}

export function lineDrawable(gen: Generator, el: Element, options: Options) {
  return gen.linearPath(linePoints(el), options);
}
