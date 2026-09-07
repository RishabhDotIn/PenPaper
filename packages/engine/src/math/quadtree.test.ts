import { describe, expect, it } from "vitest";
import { Quadtree } from "./quadtree";

describe("Quadtree", () => {
  it("returns only ids whose bounds intersect the query area", () => {
    const tree = new Quadtree({ x: 0, y: 0, width: 1000, height: 1000 });
    tree.insert("a", { x: 0, y: 0, width: 10, height: 10 });
    tree.insert("b", { x: 500, y: 500, width: 10, height: 10 });
    expect(tree.query({ x: 0, y: 0, width: 50, height: 50 })).toEqual(["a"]);
  });

  it("keeps every id reachable after subdividing", () => {
    const tree = new Quadtree({ x: 0, y: 0, width: 1000, height: 1000 }, 2, 6);
    const boxes = [];
    for (let i = 0; i < 100; i += 1) {
      const box = { x: (i % 10) * 100, y: Math.floor(i / 10) * 100, width: 10, height: 10 };
      boxes.push({ id: `e${i}`, box });
      tree.insert(`e${i}`, box);
    }
    for (const { id, box } of boxes) {
      expect(tree.query(box)).toContain(id);
    }
  });

  it("empties on clear", () => {
    const tree = new Quadtree({ x: 0, y: 0, width: 100, height: 100 });
    tree.insert("a", { x: 1, y: 1, width: 2, height: 2 });
    tree.clear();
    expect(tree.query({ x: 0, y: 0, width: 100, height: 100 })).toEqual([]);
  });
});
