import { describe, expect, it, vi } from "vitest";
import { Scene } from "../scene/scene";
import { createElement } from "../scene/factory";
import { InputController } from "./controller";
import type { PointerInput } from "./pointer";

const basePointer: PointerInput = {
  id: 1,
  type: "mouse",
  x: 0,
  y: 0,
  pressure: 0.5,
  shift: false,
  alt: false,
  ctrl: false,
  meta: false,
};

function makeDeps() {
  const scene = new Scene();
  const onSceneChange = vi.fn();
  return {
    scene,
    camera: { x: 0, y: 0, zoom: 1 },
    onSceneChange,
    onRender: vi.fn(),
    onSelectionChange: vi.fn(),
  };
}

describe("InputController", () => {
  it("creates a rectangle spanning the drag", () => {
    const deps = makeDeps();
    const c = new InputController(deps);
    c.setTool("rectangle");

    c.pointerDown({ ...basePointer, x: 100, y: 100 });
    c.pointerMove({ ...basePointer, x: 180, y: 160 });
    c.pointerUp({ ...basePointer, x: 180, y: 160 });

    const [el] = deps.scene.ordered();
    expect(el).toMatchObject({ type: "rectangle", x: 100, y: 100, width: 80, height: 60 });
    expect(deps.onSceneChange).toHaveBeenCalledTimes(1);
  });

  it("normalises a drag that goes up and to the left", () => {
    const deps = makeDeps();
    const c = new InputController(deps);
    c.setTool("ellipse");

    c.pointerDown({ ...basePointer, x: 200, y: 200 });
    c.pointerMove({ ...basePointer, x: 120, y: 140 });
    c.pointerUp({ ...basePointer, x: 120, y: 140 });

    const [el] = deps.scene.ordered();
    expect(el).toMatchObject({ x: 120, y: 140, width: 80, height: 60 });
  });

  it("gives a default size when the pointer barely moves", () => {
    const deps = makeDeps();
    const c = new InputController(deps);
    c.setTool("diamond");

    c.pointerDown({ ...basePointer, x: 50, y: 50 });
    c.pointerUp({ ...basePointer, x: 51, y: 51 });

    expect(deps.scene.ordered()[0]).toMatchObject({ x: 50, y: 50, width: 100, height: 100 });
  });

  it("accumulates freedraw points relative to the stroke box", () => {
    const deps = makeDeps();
    const c = new InputController(deps);
    c.setTool("freedraw");

    c.pointerDown({ ...basePointer, type: "pen", x: 100, y: 100, pressure: 0.3 });
    c.pointerMove({ ...basePointer, type: "pen", x: 120, y: 130, pressure: 0.7 });
    c.pointerMove({ ...basePointer, type: "pen", x: 140, y: 110, pressure: 0.9 });
    c.pointerUp({ ...basePointer, type: "pen", x: 140, y: 110 });

    const [el] = deps.scene.ordered();
    expect(el).toMatchObject({ type: "freedraw", x: 100, y: 100, width: 40, height: 30 });
    expect(el?.points.length).toBeGreaterThanOrEqual(3);
  });

  it("cancels an in-progress stroke when a second finger lands", () => {
    const deps = makeDeps();
    const c = new InputController(deps);
    c.setTool("rectangle");

    c.pointerDown({ ...basePointer, id: 1, type: "touch", x: 0, y: 0 });
    c.pointerMove({ ...basePointer, id: 1, type: "touch", x: 60, y: 60 });
    c.pointerDown({ ...basePointer, id: 2, type: "touch", x: 100, y: 100 });

    expect(deps.scene.ordered()).toHaveLength(0);
  });

  it("pans with the hand tool", () => {
    const deps = makeDeps();
    const c = new InputController(deps);
    c.setTool("hand");

    c.pointerDown({ ...basePointer, x: 100, y: 100 });
    c.pointerMove({ ...basePointer, x: 160, y: 130 });
    c.pointerUp({ ...basePointer, x: 160, y: 130 });

    expect(c.getCamera()).toMatchObject({ x: 60, y: 30, zoom: 1 });
  });

  it("zooms under the cursor on a ctrl-wheel", () => {
    const deps = makeDeps();
    const c = new InputController(deps);

    c.wheel({ x: 400, y: 300, deltaX: 0, deltaY: -100, ctrl: true, meta: false, shift: false });

    expect(c.getCamera().zoom).toBeGreaterThan(1);
  });

  it("erases the topmost element under the pointer", () => {
    const deps = makeDeps();
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    deps.scene.add(el);

    const c = new InputController({ ...deps, hitTest: () => el.id });
    c.setTool("eraser");
    c.pointerDown({ ...basePointer, x: 50, y: 50 });

    expect(deps.scene.ordered()).toHaveLength(0);
  });

  it("selects and moves an element with the select tool", () => {
    const deps = makeDeps();
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    deps.scene.add(el);

    const c = new InputController({ ...deps, hitTest: () => el.id });
    c.pointerDown({ ...basePointer, x: 50, y: 50 });
    expect(c.selection).toEqual([el.id]);

    c.pointerMove({ ...basePointer, x: 80, y: 90 });
    c.pointerUp({ ...basePointer, x: 80, y: 90 });

    expect(deps.scene.get(el.id)).toMatchObject({ x: 30, y: 40 });
  });

  it("returns to idle after every gesture", () => {
    const deps = makeDeps();
    const c = new InputController(deps);
    c.setTool("rectangle");

    c.pointerDown({ ...basePointer, x: 10, y: 10 });
    c.pointerUp({ ...basePointer, x: 60, y: 60 });

    expect(c.state).toBe("idle");
  });
});
