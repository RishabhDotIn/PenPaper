import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene";
import { createElement } from "../scene/factory";
import { elementBounds } from "./bounds";
import { hitTest } from "./hit-test";
import { Quadtree } from "./quadtree";

function sceneTree(scene: Scene): Quadtree {
  const tree = new Quadtree({ x: -10_000, y: -10_000, width: 20_000, height: 20_000 });
  for (const el of scene.ordered()) tree.insert(el.id, elementBounds(el));
  return tree;
}

describe("hitTest", () => {
  it("hit-tests the topmost element first", () => {
    const scene = new Scene();
    scene.add({ ...createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "T"), id: "bottom" });
    scene.add({ ...createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "U"), id: "top" });
    const tree = sceneTree(scene);
    expect(hitTest(scene, tree, { x: 50, y: 50 })).toBe("top");
  });

  it("misses the hole of an unfilled ellipse but hits its edge", () => {
    const scene = new Scene();
    scene.add(createElement("ellipse", { x: 0, y: 0, width: 100, height: 100 }, "V"));
    const tree = sceneTree(scene);
    expect(hitTest(scene, tree, { x: 50, y: 50 })).toBeNull();
    expect(hitTest(scene, tree, { x: 50, y: 3 })).not.toBeNull();
  });

  it("ignores deleted elements", () => {
    const scene = new Scene();
    const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V");
    scene.add(el);
    scene.remove(el.id);
    expect(hitTest(scene, sceneTree(scene), { x: 50, y: 50 })).toBeNull();
  });

  it("hits a thin line only near the stroke", () => {
    const scene = new Scene();
    scene.add(createElement("line", { x: 0, y: 0, width: 100, height: 100 }, "V"));
    const tree = sceneTree(scene);
    expect(hitTest(scene, tree, { x: 50, y: 50 })).not.toBeNull();
    expect(hitTest(scene, tree, { x: 50, y: 90 })).toBeNull();
  });
});
