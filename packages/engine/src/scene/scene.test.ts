import { describe, expect, it } from "vitest";
import { createElement } from "./factory";
import { Scene } from "./scene";

describe("Scene", () => {
  it("orders by index and skips deleted elements", () => {
    const scene = new Scene();
    scene.add({ ...createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, "V"), id: "b" });
    scene.add({ ...createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, "T"), id: "a" });
    scene.add({ ...createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, "W"), id: "c" });
    scene.remove("b");
    expect(scene.ordered().map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("bumps version and updatedAt on update", () => {
    const scene = new Scene();
    const el = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, "V");
    scene.add(el);
    const before = scene.get(el.id)!;
    scene.update(el.id, { x: 50 });
    const after = scene.get(el.id)!;
    expect(after.x).toBe(50);
    expect(after.version).toBe(before.version + 1);
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it("returns the union bounds of live elements, or null when empty", () => {
    const scene = new Scene();
    expect(scene.bounds()).toBeNull();
    scene.add(createElement("rectangle", { x: 10, y: 20, width: 30, height: 40 }, "V"));
    scene.add(createElement("rectangle", { x: 100, y: 0, width: 20, height: 10 }, "T"));
    expect(scene.bounds()).toEqual({ x: 10, y: 0, width: 110, height: 60 });
  });
});
