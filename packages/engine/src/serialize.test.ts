import { describe, expect, it } from "vitest";
import { createElement } from "./scene/factory";
import { Scene } from "./scene/scene";
import { SCENE_VERSION, deserializeScene, serializeScene } from "./serialize";

function sceneWith(...types: Parameters<typeof createElement>[0][]): Scene {
  const scene = new Scene();
  types.forEach((type, index) => {
    scene.add(createElement(type, { x: index * 10, y: index * 20, width: 100, height: 50 }, `a${index}`));
  });
  return scene;
}

describe("serializeScene", () => {
  it("round-trips a scene through JSON", () => {
    const scene = new Scene();
    const freedraw = createElement("freedraw", { x: 0, y: 0, width: 10, height: 10 }, "V");
    scene.add(freedraw);
    scene.update(freedraw.id, {
      points: [
        [0, 0, 0.5],
        [4, 2, 0.7],
      ],
      strokeColor: "#e03131",
    });

    const restored = deserializeScene(serializeScene(scene));
    expect(restored.ordered()).toEqual(scene.ordered());
  });

  it("writes the version and only live elements", () => {
    const scene = sceneWith("rectangle", "ellipse");
    const doomed = scene.ordered()[0]!;
    scene.remove(doomed.id);

    const parsed = JSON.parse(serializeScene(scene)) as {
      version: number;
      elements: Array<{ id: string }>;
    };

    expect(parsed.version).toBe(SCENE_VERSION);
    expect(parsed.elements.map((element) => element.id)).not.toContain(doomed.id);
  });

  it("preserves paint order", () => {
    const scene = sceneWith("rectangle", "ellipse", "diamond");
    const restored = deserializeScene(serializeScene(scene));

    expect(restored.ordered().map((element) => element.index)).toEqual(
      scene.ordered().map((element) => element.index),
    );
  });

  it("keeps bindings, arrowheads, and text fields", () => {
    const scene = new Scene();
    const arrow = createElement("arrow", { x: 0, y: 0, width: 100, height: 40 }, "a1");
    scene.add({
      ...arrow,
      startBinding: { elementId: "target-a", focus: 0.25 },
      endBinding: { elementId: "target-b", focus: 0.75 },
      startArrowhead: "dot",
      endArrowhead: "arrow",
      text: "flow",
      fontSize: 28,
    });

    const restored = deserializeScene(serializeScene(scene)).ordered()[0]!;
    expect(restored).toMatchObject({
      startBinding: { elementId: "target-a", focus: 0.25 },
      endBinding: { elementId: "target-b", focus: 0.75 },
      startArrowhead: "dot",
      endArrowhead: "arrow",
      text: "flow",
      fontSize: 28,
    });
  });
});

describe("deserializeScene", () => {
  it("skips malformed elements instead of losing the board", () => {
    const json = JSON.stringify({
      version: 1,
      elements: [
        { id: "good", type: "rectangle", x: 0, y: 0, width: 10, height: 10, index: "a" },
        { id: "no-type", x: 0, y: 0, width: 10, height: 10, index: "b" },
        { id: "nan-geometry", type: "rectangle", x: null, y: 0, width: 10, height: 10, index: "c" },
        null,
        "nonsense",
      ],
    });

    const scene = deserializeScene(json);
    expect(scene.ordered().map((element) => element.id)).toEqual(["good"]);
  });

  it("fills in fields an older snapshot did not have", () => {
    const json = JSON.stringify({
      version: 1,
      elements: [{ id: "old", type: "rectangle", x: 1, y: 2, width: 3, height: 4, index: "a" }],
    });

    const element = deserializeScene(json).ordered()[0]!;
    expect(element).toMatchObject({
      id: "old",
      angle: 0,
      opacity: 100,
      strokeWidth: 2,
      startBinding: null,
      src: "",
    });
  });

  it("drops duplicate ids", () => {
    const raw = { id: "same", type: "rectangle", x: 0, y: 0, width: 10, height: 10, index: "a" };
    const scene = deserializeScene(JSON.stringify({ version: 1, elements: [raw, raw] }));
    expect(scene.ordered()).toHaveLength(1);
  });

  it("rejects an unsupported version and invalid JSON", () => {
    expect(() => deserializeScene(JSON.stringify({ version: 99, elements: [] }))).toThrow(
      /unsupported board version/,
    );
    expect(() => deserializeScene("{not json")).toThrow();
  });
});
