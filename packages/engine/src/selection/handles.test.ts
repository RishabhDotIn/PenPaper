import { describe, expect, it } from "vitest";
import { createElement } from "../scene/factory";
import { getHandles, handleAt, isCornerHandle, type HandlePoint } from "./handles";

const CAMERA = { x: 0, y: 0, zoom: 1 };

function point(handles: HandlePoint[], handle: string) {
  const found = handles.find((h) => h.handle === handle);
  if (!found) throw new Error(`missing handle ${handle}`);

  // `Math.round(-0.0001)` is -0, which `toEqual` treats as different from 0.
  const clean = (n: number) => {
    const rounded = Math.round(n * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  return { x: clean(found.point.x), y: clean(found.point.y) };
}

describe("getHandles", () => {
  it("puts the corners on the element box at 100% zoom", () => {
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    const handles = getHandles(el, CAMERA);

    expect(handles).toHaveLength(9);
    expect(point(handles, "nw")).toEqual({ x: 0, y: 0 });
    expect(point(handles, "n")).toEqual({ x: 50, y: 0 });
    expect(point(handles, "se")).toEqual({ x: 100, y: 100 });
    expect(point(handles, "w")).toEqual({ x: 0, y: 50 });
  });

  it("floats the rotation handle above the top edge, in screen pixels", () => {
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");

    // 22 px above the top edge is a screen-space offset: it must not shrink at
    // 0.1x zoom, which is exactly where a scene-space handle would vanish.
    expect(point(getHandles(el, CAMERA), "rotation")).toEqual({ x: 50, y: -22 });
    expect(point(getHandles(el, { x: 0, y: 0, zoom: 0.1 }), "rotation")).toEqual({ x: 5, y: -22 });
  });

  it("applies the camera transform", () => {
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    const handles = getHandles(el, { x: 10, y: 20, zoom: 2 });

    expect(point(handles, "nw")).toEqual({ x: 10, y: 20 });
    expect(point(handles, "se")).toEqual({ x: 210, y: 220 });
  });

  it("rotates the corner handles with the element", () => {
    const el = {
      ...createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V"),
      angle: Math.PI / 2,
    };
    const handles = getHandles(el, CAMERA);

    // A quarter turn clockwise maps the local (-50,-50) corner to (+50,-50).
    expect(point(handles, "nw")).toEqual({ x: 100, y: 0 });
    expect(point(handles, "se")).toEqual({ x: 0, y: 100 });
    // The rotation handle follows the rotated top edge, sticking out right.
    expect(point(handles, "rotation")).toEqual({ x: 122, y: 50 });
  });

  it("works for a zero-height element without producing NaN", () => {
    const el = createElement("line", { x: 0, y: 0, width: 100, height: 0 }, "V");
    for (const { point: p } of getHandles(el, CAMERA)) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  // The dots are meant to sit on the shape. A corner of a diamond's bounding
  // box is empty paper, so the generic eight-handle grid is wrong for anything
  // whose silhouette is not a rectangle.
  it("gives a diamond and an ellipse four cardinal handles", () => {
    for (const type of ["diamond", "ellipse"] as const) {
      const el = createElement(type, { x: 0, y: 0, width: 100, height: 100 }, "V");
      const handles = getHandles(el, CAMERA);

      expect(handles.map((h) => h.handle)).toEqual(["n", "e", "s", "w", "rotation"]);
      expect(point(handles, "n")).toEqual({ x: 50, y: 0 });
      expect(point(handles, "e")).toEqual({ x: 100, y: 50 });
      expect(point(handles, "s")).toEqual({ x: 50, y: 100 });
      expect(point(handles, "w")).toEqual({ x: 0, y: 50 });
    }
  });

  it("puts a triangle's handles on its three corners", () => {
    const el = createElement("triangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    const handles = getHandles(el, CAMERA);

    expect(handles).toHaveLength(4);
    expect(point(handles, "n")).toEqual({ x: 50, y: 0 });
    expect(point(handles, "se")).toEqual({ x: 100, y: 100 });
    expect(point(handles, "sw")).toEqual({ x: 0, y: 100 });
  });

  it("follows a hexagon's six corners", () => {
    const el = createElement("hexagon", { x: 0, y: 0, width: 100, height: 100 }, "V");
    const handles = getHandles(el, CAMERA);

    expect(handles).toHaveLength(7);
    expect(point(handles, "nw")).toEqual({ x: 25, y: 0 });
    expect(point(handles, "ne")).toEqual({ x: 75, y: 0 });
    expect(point(handles, "e")).toEqual({ x: 100, y: 50 });
    expect(point(handles, "se")).toEqual({ x: 75, y: 100 });
    expect(point(handles, "sw")).toEqual({ x: 25, y: 100 });
    expect(point(handles, "w")).toEqual({ x: 0, y: 50 });
  });

  it("shows only a star's five outer tips", () => {
    const el = createElement("star", { x: 0, y: 0, width: 100, height: 100 }, "V");
    const handles = getHandles(el, CAMERA);

    // Ten corners would be a ring of dots; the inner ones are not the
    // silhouette and are awkward targets on a phone.
    expect(handles).toHaveLength(6);
    expect(point(handles, "n")).toEqual({ x: 50, y: 0 });

    const tips = handles.filter((h) => h.handle !== "rotation");
    expect(new Set(tips.map((h) => `${h.handle}:${h.point.x}:${h.point.y}`)).size).toBe(5);
  });

  it("still rings a rectangle with all eight box handles", () => {
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    expect(getHandles(el, CAMERA).map((h) => h.handle)).toEqual([
      "nw",
      "n",
      "ne",
      "e",
      "se",
      "s",
      "sw",
      "w",
      "rotation",
    ]);
  });
});

describe("handleAt", () => {
  const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
  const handles = getHandles(el, CAMERA);

  it("finds the handle under the pointer", () => {
    expect(handleAt(handles, { x: 101, y: 99 })).toBe("se");
    expect(handleAt(handles, { x: 50, y: -23 })).toBe("rotation");
  });

  it("returns null when the pointer is not near a handle", () => {
    expect(handleAt(handles, { x: 50, y: 50 })).toBeNull();
    expect(handleAt(handles, { x: 400, y: 400 })).toBeNull();
  });

  it("lets the rotation handle win a tie with an overlapping corner", () => {
    const overlapping: HandlePoint[] = [
      { handle: "se", point: { x: 10, y: 10 } },
      { handle: "rotation", point: { x: 10, y: 10 } },
    ];
    expect(handleAt(overlapping, { x: 10, y: 10 })).toBe("rotation");
  });

  it("respects the radius", () => {
    expect(handleAt(handles, { x: 100, y: 100 }, 3)).toBe("se");
    expect(handleAt(handles, { x: 104, y: 104 }, 3)).toBeNull();
  });
});

describe("isCornerHandle", () => {
  it("separates corners from edges and the rotation handle", () => {
    expect(isCornerHandle("nw")).toBe(true);
    expect(isCornerHandle("n")).toBe(false);
    expect(isCornerHandle("rotation")).toBe(false);
  });
});
