import { describe, expect, it } from "vitest";
import { fitCamera, sceneToScreen, screenToScene, zoomAt } from "./camera";

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

  it("centres content inside the insets the chrome leaves free", () => {
    const camera = fitCamera(
      { x: 44, y: 34, width: 296, height: 572 },
      { width: 1440, height: 900 },
      { top: 64, right: 264, bottom: 64, left: 80 },
    );

    expect(camera.zoom).toBe(1);
    // The free area is x 80..1176 and y 64..836; the scene's centre must land
    // in its middle rather than at the viewport's middle.
    const centre = sceneToScreen(camera, { x: 44 + 296 / 2, y: 34 + 572 / 2 });
    expect(centre.x).toBeCloseTo(80 + (1096 - 296) / 2 + 148, 6);
    expect(centre.y).toBeCloseTo(64 + (772 - 572) / 2 + 286, 6);
  });

  it("shrinks content that does not fit but never zooms past 100%", () => {
    const bounds = { x: 0, y: 0, width: 1000, height: 500 };
    const small = fitCamera(bounds, { width: 400, height: 300 }, undefined, 1);
    expect(small.zoom).toBeLessThan(1);

    const large = fitCamera(bounds, { width: 4000, height: 3000 }, undefined, 1);
    expect(large.zoom).toBe(1);
  });
});
