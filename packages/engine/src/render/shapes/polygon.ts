import type { Element } from "@penpaper/shared";
import type { Generator } from "../rough-cache";
import type { Options } from "roughjs/bin/core";
import { polygonPoints, type PolygonShape } from "../../math/polygon";

/**
 * Triangles, hexagons, and stars are the same rough.js call with a different
 * corner list. Keeping one adapter means a new polygon type costs a vertex
 * table entry, not a new renderer.
 */
export function polygonDrawable(
  gen: Generator,
  type: PolygonShape,
  el: Element,
  options: Options,
) {
  const points = polygonPoints(type, el.width, el.height).map(
    (point): [number, number] => [point.x, point.y],
  );
  return gen.polygon(points, options);
}
