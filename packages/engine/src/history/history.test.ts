import { describe, expect, it } from "vitest";
import { createElement } from "../scene/factory";
import { Scene } from "../scene/scene";
import { addCommand } from "./commands";
import { History } from "./history";

function setup() {
  const scene = new Scene();
  const element = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, "V");
  scene.add(element);
  return { scene, element, history: new History(scene) };
}

describe("History", () => {
  it("collapses a whole drag into one undo step", () => {
    const { scene, element, history } = setup();

    history.begin("move");
    for (let i = 0; i < 50; i += 1) scene.update(element.id, { x: i });
    history.commit();

    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(scene.get(element.id)?.x).toBe(0);
    expect(history.canUndo()).toBe(false);
  });

  it("redo restores the committed result", () => {
    const { scene, element, history } = setup();

    history.begin("resize");
    scene.update(element.id, { width: 200, height: 120 });
    history.commit();
    history.undo();
    expect(scene.get(element.id)?.width).toBe(10);

    expect(history.redo()).toBe(true);
    expect(scene.get(element.id)).toMatchObject({ width: 200, height: 120 });
  });

  it("discards a transaction that changed nothing", () => {
    const { history } = setup();
    history.begin("move");
    history.commit();
    expect(history.canUndo()).toBe(false);
  });

  it("clears the redo stack after a new command", () => {
    const scene = new Scene();
    const history = new History(scene);
    const first = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, "V");
    scene.add(first);

    history.push(addCommand(first));
    history.undo();
    expect(history.canRedo()).toBe(true);

    const second = createElement("ellipse", { x: 0, y: 0, width: 10, height: 10 }, "W");
    scene.add(second);
    history.push(addCommand(second));
    expect(history.canRedo()).toBe(false);
  });

  it("undoes a newly added element into a tombstone and redoes it", () => {
    const scene = new Scene();
    const history = new History(scene);

    history.begin("draw");
    const element = createElement("diamond", { x: 0, y: 0, width: 40, height: 40 }, "V");
    scene.add(element);
    history.commit();

    expect(scene.size).toBe(1);
    history.undo();
    expect(scene.size).toBe(0);
    history.redo();
    expect(scene.size).toBe(1);
  });

  it("can be cancelled without recording anything", () => {
    const { scene, element, history } = setup();

    history.begin("move");
    scene.update(element.id, { x: 999 });
    history.cancel();
    scene.update(element.id, { x: 0 });

    expect(history.canUndo()).toBe(false);
  });

  it("caps the undo stack and drops the oldest command", () => {
    const scene = new Scene();
    const history = new History(scene, 3);

    for (let i = 0; i < 5; i += 1) {
      const element = createElement("rectangle", { x: i, y: 0, width: 10, height: 10 }, "V");
      scene.add(element);
      history.push(addCommand(element, `add-${i}`));
    }

    let undos = 0;
    while (history.undo()) undos += 1;
    expect(undos).toBe(3);
  });

  it("commits an open transaction before beginning the next one", () => {
    const { scene, element, history } = setup();

    history.begin("first");
    scene.update(element.id, { x: 100 });
    history.begin("second");
    scene.update(element.id, { x: 200 });
    history.commit();

    history.undo();
    expect(scene.get(element.id)?.x).toBe(100);
    history.undo();
    expect(scene.get(element.id)?.x).toBe(0);
  });

  it("returns false when there is nothing to undo or redo", () => {
    const { history } = setup();
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
  });
});
