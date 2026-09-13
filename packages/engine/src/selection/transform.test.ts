import { describe, expect, it } from "vitest";
import { createElement } from "../scene/factory";
import { normalizeAngle, resizeElement, rotateElement } from "./transform";

const opts = { keepAspect: false, fromCenter: false };

function rect(width = 100, height = 50, x = 0, y = 0) {
  return createElement("rectangle", { x, y, width, height }, "V");
}

describe("resizeElement", () => {
  it("grows from the east edge and leaves the west edge anchored", () => {
    const result = resizeElement(rect(), "e", { x: 150, y: 25 }, opts);
    expect(result).toMatchObject({ x: 0, y: 0, width: 150, height: 50 });
  });

  it("grows from the west edge and keeps the east edge anchored", () => {
    const result = resizeElement(rect(), "w", { x: 20, y: 25 }, opts);
    expect(result).toMatchObject({ x: 20, y: 0, width: 80, height: 50 });
  });

  it("resizes from a corner on both axes", () => {
    const result = resizeElement(rect(), "se", { x: 200, y: 100 }, opts);
    expect(result).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
  });

  it("shrinks from a corner without flipping", () => {
    const result = resizeElement(rect(), "nw", { x: 25, y: 10 }, opts);
    expect(result).toMatchObject({ x: 25, y: 10, width: 75, height: 40 });
  });

  it("never collapses below one scene unit", () => {
    const result = resizeElement(rect(), "e", { x: -500, y: 25 }, opts);
    expect(result.width).toBe(1);
    expect(result.x).toBe(0);
  });

  it("mirrors around the centre when resizing from the centre", () => {
    const result = resizeElement(rect(), "e", { x: 150, y: 25 }, {
      keepAspect: false,
      fromCenter: true,
    });
    // Centre is (50, 25), so the right edge at 150 means a half-width of 100.
    expect(result).toMatchObject({ x: -50, y: 0, width: 200, height: 50 });
  });

  it("keeps the aspect ratio on a corner when asked", () => {
    const result = resizeElement(rect(100, 50), "se", { x: 200, y: 60 }, {
      keepAspect: true,
      fromCenter: false,
    });
    expect(result.width).toBeCloseTo(200, 6);
    expect(result.height).toBeCloseTo(100, 6);
    // Top and left edges stay put.
    expect(result.x).toBeCloseTo(0, 6);
    expect(result.y).toBeCloseTo(0, 6);
  });

  it("keeps the aspect ratio from a side handle", () => {
    const result = resizeElement(rect(100, 50), "e", { x: 200, y: 25 }, {
      keepAspect: true,
      fromCenter: false,
    });
    expect(result.width).toBeCloseTo(200, 6);
    expect(result.height).toBeCloseTo(100, 6);
    // The height grows symmetrically about the original horizontal centre line.
    expect(result.x).toBeCloseTo(0, 6);
    expect(result.y).toBeCloseTo(-25, 6);
  });

  it("resizes along the element's own axes when it is rotated", () => {
    const el = { ...rect(100, 100), angle: Math.PI / 2 };
    // Centre is (50, 50); a quarter turn puts the element's +x axis on screen +y.
    const result = resizeElement(el, "e", { x: 50, y: 200 }, opts);

    expect(result.width).toBeCloseTo(200, 6);
    expect(result.height).toBeCloseTo(100, 6);
    expect(result.x).toBeCloseTo(-50, 6);
    expect(result.y).toBeCloseTo(50, 6);
  });

  it("preserves the centre when the element is rotated and resized from the centre", () => {
    const el = { ...rect(100, 100), angle: 0.4 };
    // Pull along the element's own +x axis so the test measures the axis it
    // claims to measure.
    const pointer = {
      x: 50 + 100 * Math.cos(0.4),
      y: 50 + 100 * Math.sin(0.4),
    };
    const result = resizeElement(el, "e", pointer, {
      keepAspect: false,
      fromCenter: true,
    });

    expect(result.width).toBeCloseTo(200, 6);
    expect(result.x! + result.width! / 2).toBeCloseTo(50, 6);
    expect(result.y! + result.height! / 2).toBeCloseTo(50, 6);
  });

  it("ignores the rotation handle", () => {
    expect(resizeElement(rect(), "rotation", { x: 0, y: 0 }, opts)).toEqual({});
  });
});

describe("rotateElement", () => {
  const el = rect(100, 100);

  it("is a no-op at the handle's rest position", () => {
    // Directly above the centre: the handle rests here, so the element must
    // not jump a quarter turn when grabbed.
    expect(rotateElement(el, { x: 50, y: 10 }, { snap: false })).toEqual({ angle: 0 });
  });

  it("reports +90° when the handle is dragged to the right", () => {
    const result = rotateElement(el, { x: 150, y: 50 }, { snap: false });
    expect(result.angle).toBeCloseTo(Math.PI / 2, 6);
  });

  it("snaps to 15 degree steps when requested", () => {
    // 18° clockwise from straight up: close enough to 15° to snap, and far
    // enough that a free rotation would report something else.
    const radius = 40;
    const direction = -Math.PI / 2 + Math.PI / 10;
    const pointer = {
      x: 50 + radius * Math.cos(direction),
      y: 50 + radius * Math.sin(direction),
    };

    expect(rotateElement(el, pointer, { snap: true }).angle).toBeCloseTo(Math.PI / 12, 6);
    expect(rotateElement(el, pointer, { snap: false }).angle).toBeCloseTo(Math.PI / 10, 6);
  });

  it("snaps a near-30° drag to 30°", () => {
    const direction = -Math.PI / 2 + (28 * Math.PI) / 180;
    const pointer = { x: 50 + 40 * Math.cos(direction), y: 50 + 40 * Math.sin(direction) };
    const result = rotateElement(el, pointer, { snap: true });
    expect(result.angle).toBeCloseTo(Math.PI / 6, 6);
  });

  it("leaves an already-rotated element at its angle when the handle is grabbed", () => {
    const rotated = { ...el, angle: Math.PI / 6 };
    const centre = { x: 50, y: 50 };
    const direction = -Math.PI / 2 + Math.PI / 6;
    const pointer = {
      x: centre.x + 70 * Math.cos(direction),
      y: centre.y + 70 * Math.sin(direction),
    };

    expect(rotateElement(rotated, pointer, { snap: false }).angle).toBeCloseTo(Math.PI / 6, 6);
  });

  it("reports angles past 180° instead of flipping the element", () => {
    // Straight down is 180°: the handle is below the centre, which is legal
    // and must not be reported as a small negative angle.
    const direction = Math.PI / 2 + 0.1;
    const pointer = { x: 50 + 40 * Math.cos(direction), y: 50 + 40 * Math.sin(direction) };
    const angle = rotateElement(el, pointer, { snap: false }).angle ?? 0;
    expect(angle).toBeCloseTo(Math.PI + 0.1, 6);
  });
});

describe("normalizeAngle", () => {
  it("maps negatives into [0, 2π)", () => {
    expect(normalizeAngle(-0.1)).toBeCloseTo(Math.PI * 2 - 0.1, 6);
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((Math.PI * 3) / 2, 6);
  });

  it("leaves in-range angles alone", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(1)).toBeCloseTo(1, 6);
    expect(normalizeAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 6);
  });
});
