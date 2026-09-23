import { describe, expect, it } from "vitest";
import { Scene, deserializeScene, serializeScene } from "@penpaper/engine";
import { createDemoElements } from "./demo-board";

describe("demo board", () => {
  const elements = createDemoElements();

  it("fills a board with more than one kind of element", () => {
    const types = new Set(elements.map((element) => element.type));

    expect(elements.length).toBeGreaterThanOrEqual(12);
    expect(types).toContain("text");
    expect(types).toContain("rectangle");
    expect(types).toContain("arrow");
    expect(types).toContain("freedraw");
  });

  it("uses unique ids and strictly increasing paint order", () => {
    expect(new Set(elements.map((element) => element.id)).size).toBe(elements.length);

    const indices = elements.map((element) => element.index);
    expect(indices).toEqual([...indices].sort());
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("fits a 390 × 844 phone viewport", () => {
    for (const element of elements) {
      expect(element.x, element.id).toBeGreaterThanOrEqual(0);
      expect(element.y, element.id).toBeGreaterThanOrEqual(0);
      expect(element.x + element.width, element.id).toBeLessThanOrEqual(390);
      expect(element.y + element.height, element.id).toBeLessThanOrEqual(844);
    }
  });

  it("survives the persistence round trip unchanged", () => {
    const scene = new Scene();
    for (const element of elements) scene.add(element);

    const restored = deserializeScene(serializeScene(scene));
    expect(restored.ordered()).toEqual(scene.ordered());
  });
});
