import { describe, expect, it, vi } from "vitest";
import { Scene } from "../scene/scene";
import { createElement } from "../scene/factory";
import { History } from "../history/history";
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

  it("resizes from the south-east handle of the selected element", () => {
    const deps = makeDeps();
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    deps.scene.add(el);

    const c = new InputController({ ...deps, hitTest: () => el.id });
    c.pointerDown({ ...basePointer, x: 50, y: 50 });
    c.pointerUp({ ...basePointer, x: 50, y: 50 });

    // The corner handle sits on the element's own corner at 100% zoom.
    c.pointerDown({ ...basePointer, x: 100, y: 100 });
    expect(c.state).toBe("resizing");

    c.pointerMove({ ...basePointer, x: 200, y: 150 });
    c.pointerUp({ ...basePointer, x: 200, y: 150 });

    expect(deps.scene.get(el.id)).toMatchObject({ x: 0, y: 0, width: 200, height: 150 });
    expect(c.state).toBe("idle");
  });

  it("resizes in screen space, so handles stay reachable when zoomed in", () => {
    const deps = makeDeps();
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    deps.scene.add(el);

    const c = new InputController({ ...deps, camera: { x: 0, y: 0, zoom: 2 }, hitTest: () => el.id });
    c.pointerDown({ ...basePointer, x: 100, y: 100 });
    c.pointerUp({ ...basePointer, x: 100, y: 100 });

    // At 2x the south-east corner is at screen (200, 200).
    c.pointerDown({ ...basePointer, x: 200, y: 200 });
    expect(c.state).toBe("resizing");
    c.pointerMove({ ...basePointer, x: 400, y: 400 });
    c.pointerUp({ ...basePointer, x: 400, y: 400 });

    expect(deps.scene.get(el.id)).toMatchObject({ width: 200, height: 200 });
  });

  it("rotates around the element centre from the rotation handle", () => {
    const deps = makeDeps();
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    deps.scene.add(el);

    const c = new InputController({ ...deps, hitTest: () => el.id });
    c.pointerDown({ ...basePointer, x: 50, y: 50 });
    c.pointerUp({ ...basePointer, x: 50, y: 50 });

    c.pointerDown({ ...basePointer, x: 50, y: -22 });
    expect(c.state).toBe("rotating");

    c.pointerMove({ ...basePointer, x: 150, y: 50 });
    c.pointerUp({ ...basePointer, x: 150, y: 50 });

    expect(deps.scene.get(el.id)?.angle).toBeCloseTo(Math.PI / 2, 6);
  });

  it("commits a rotation even if the pointer has not moved", () => {
    const deps = makeDeps();
    const el = { ...createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V"), angle: 0.4 };
    deps.scene.add(el);

    const c = new InputController({ ...deps, hitTest: () => el.id });
    c.pointerDown({ ...basePointer, x: 50, y: 50 });
    c.pointerUp({ ...basePointer, x: 50, y: 50 });

    const handle = { x: 50 + Math.sin(0.4) * 72, y: 50 - Math.cos(0.4) * 72 };
    c.pointerDown({ ...basePointer, ...handle });
    c.pointerUp({ ...basePointer, ...handle });

    expect(deps.scene.get(el.id)?.angle).toBeCloseTo(0.4, 6);
  });

  it("restores the element when a transform is cancelled", () => {
    const deps = makeDeps();
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    deps.scene.add(el);

    const c = new InputController({ ...deps, hitTest: () => el.id });
    c.pointerDown({ ...basePointer, x: 50, y: 50 });
    c.pointerUp({ ...basePointer, x: 50, y: 50 });

    c.pointerDown({ ...basePointer, x: 100, y: 100 });
    c.pointerMove({ ...basePointer, x: 300, y: 300 });
    c.pointerCancel();

    expect(deps.scene.get(el.id)).toMatchObject({ width: 100, height: 100 });
    expect(c.state).toBe("idle");
  });

  it("marquee-selects every element the box touches", () => {
    const deps = makeDeps();
    const inside = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    const faraway = createElement("rectangle", { x: 400, y: 400, width: 100, height: 100 }, "W");
    deps.scene.add(inside);
    deps.scene.add(faraway);

    const c = new InputController({ ...deps, hitTest: () => null });
    c.pointerDown({ ...basePointer, x: -10, y: -10 });
    expect(c.state).toBe("selecting");

    c.pointerMove({ ...basePointer, x: 150, y: 150 });
    expect(c.marquee).toMatchObject({ x: -10, y: -10, width: 160, height: 160 });

    c.pointerUp({ ...basePointer, x: 150, y: 150 });

    expect(c.selection).toEqual([inside.id]);
    expect(c.marquee).toBeNull();
  });

  it("toggles with shift-click", () => {
    const deps = makeDeps();
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    deps.scene.add(el);

    const c = new InputController({ ...deps, hitTest: () => el.id });
    c.pointerDown({ ...basePointer, x: 50, y: 50 });
    c.pointerUp({ ...basePointer, x: 50, y: 50 });
    expect(c.selection).toEqual([el.id]);

    c.pointerDown({ ...basePointer, x: 50, y: 50, shift: true });
    c.pointerUp({ ...basePointer, x: 50, y: 50, shift: true });
    expect(c.selection).toEqual([]);

    c.pointerDown({ ...basePointer, x: 50, y: 50, shift: true });
    c.pointerUp({ ...basePointer, x: 50, y: 50, shift: true });
    expect(c.selection).toEqual([el.id]);
  });
});

describe("InputController history", () => {
  /**
   * A gesture is one undo step no matter how many pointer samples it emitted.
   * That is the whole contract the controller has with `History`; individual
   * command shapes are covered in `history.test.ts`.
   */
  it("undoes a whole drawing gesture and redoes it", () => {
    const deps = makeDeps();
    const history = new History(deps.scene);
    const c = new InputController({ ...deps, history });
    c.setTool("rectangle");

    c.pointerDown({ ...basePointer, x: 100, y: 100 });
    c.pointerMove({ ...basePointer, x: 150, y: 150 });
    c.pointerMove({ ...basePointer, x: 200, y: 200 });
    c.pointerUp({ ...basePointer, x: 200, y: 200 });

    expect(deps.scene.size).toBe(1);
    expect(history.undo()).toBe(true);
    expect(deps.scene.size).toBe(0);
    expect(history.redo()).toBe(true);
    expect(deps.scene.size).toBe(1);
  });

  it("undoes a drag as one step", () => {
    const deps = makeDeps();
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    deps.scene.add(el);

    const history = new History(deps.scene);
    const c = new InputController({ ...deps, history, hitTest: () => el.id });

    // Click selects; the drag is what moves it.
    c.pointerDown({ ...basePointer, x: 50, y: 50 });
    c.pointerUp({ ...basePointer, x: 50, y: 50 });

    c.pointerDown({ ...basePointer, x: 50, y: 50 });
    for (let i = 1; i <= 10; i += 1) {
      c.pointerMove({ ...basePointer, x: 50 + i * 10, y: 50 });
    }
    c.pointerUp({ ...basePointer, x: 150, y: 50 });

    expect(deps.scene.get(el.id)?.x).toBeCloseTo(100, 6);

    expect(history.undo()).toBe(true);
    expect(deps.scene.get(el.id)?.x).toBe(0);
    expect(history.canUndo()).toBe(false);
  });

  it("undoes a style patch", () => {
    const deps = makeDeps();
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    deps.scene.add(el);

    const history = new History(deps.scene);
    const c = new InputController({ ...deps, history });
    c.setSelection([el.id]);

    c.patchSelection({ strokeColor: "#ff0000" });
    expect(deps.scene.get(el.id)?.strokeColor).toBe("#ff0000");

    history.undo();
    expect(deps.scene.get(el.id)?.strokeColor).toBe(el.strokeColor);
  });

  it("undoes a delete and restores the element", () => {
    const deps = makeDeps();
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    deps.scene.add(el);

    const history = new History(deps.scene);
    const c = new InputController({ ...deps, history });
    c.setSelection([el.id]);

    c.deleteSelection();
    expect(deps.scene.size).toBe(0);

    history.undo();
    expect(deps.scene.size).toBe(1);
    expect(deps.scene.get(el.id)?.isDeleted).toBe(false);
  });
});
