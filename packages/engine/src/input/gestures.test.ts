import { describe, expect, it } from "vitest";
import { GestureArbiter } from "./gestures";
import type { PointerInput } from "./pointer";

const pointer = (id: number, x = 0, y = 0): PointerInput => ({
  id,
  type: "touch",
  x,
  y,
  pressure: 0.5,
  shift: false,
  alt: false,
  ctrl: false,
  meta: false,
});

describe("GestureArbiter", () => {
  it("cancels the in-progress stroke when a second finger lands", () => {
    const arbiter = new GestureArbiter();
    expect(arbiter.pointerDown(pointer(1), 0)).toBe("single");
    expect(arbiter.pointerDown(pointer(2), 10)).toBe("multi");
    expect(arbiter.active).toBe(2);
  });

  it("reports pinch distance and midpoint", () => {
    const arbiter = new GestureArbiter();
    arbiter.pointerDown(pointer(1, 100, 100), 0);
    arbiter.pointerDown(pointer(2, 200, 100), 0);
    expect(arbiter.pinch()).toEqual({ distance: 100, midpoint: { x: 150, y: 100 } });
  });

  it("tracks pointer movement for pinch maths", () => {
    const arbiter = new GestureArbiter();
    arbiter.pointerDown(pointer(1, 100, 100), 0);
    arbiter.pointerDown(pointer(2, 200, 100), 0);
    arbiter.pointerMove(pointer(2, 300, 100));
    expect(arbiter.pinch()?.distance).toBe(200);
  });

  it("returns to single after one finger lifts, and empty after both", () => {
    const arbiter = new GestureArbiter();
    arbiter.pointerDown(pointer(1), 0);
    arbiter.pointerDown(pointer(2), 0);
    arbiter.pointerUp(pointer(2));
    expect(arbiter.active).toBe(1);
    arbiter.pointerUp(pointer(1));
    expect(arbiter.active).toBe(0);
    expect(arbiter.pinch()).toBeNull();
  });
});
