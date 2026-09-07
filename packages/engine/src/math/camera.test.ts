import { describe, expect, it } from "vitest";
import { sceneToScreen, screenToScene, zoomAt } from "./camera";

describe("camera", () => {
  it("round-trips screen and scene coordinates", () => {
    const camera = { x: -120, y: 40, zoom: 1.75 };
    const p = { x: 310, y: 220 };
    const back = sceneToScreen(camera, screenToScene(camera, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it("keeps the scene point under the cursor fixed while zooming", () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const cursor = { x: 400, y: 300 };
    const before = screenToScene(camera, cursor);
    const after = zoomAt(camera, cursor, 2);
    const stillThere = sceneToScreen(after, before);
    expect(stillThere.x).toBeCloseTo(cursor.x, 6);
    expect(stillThere.y).toBeCloseTo(cursor.y, 6);
  });

  it("clamps zoom to the allowed range", () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 1000).zoom).toBe(30);
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 0.0001).zoom).toBe(0.1);
  });
});
