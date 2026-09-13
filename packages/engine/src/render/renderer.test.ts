import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene";
import { createElement } from "../scene/factory";
import { fakeCtx } from "../test/fake-ctx";
import { Renderer } from "./renderer";

describe("Renderer", () => {
  it("culls elements outside the viewport", () => {
    const scene = new Scene();
    scene.add({ ...createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, "V"), id: "visible" });
    scene.add({
      ...createElement("rectangle", { x: 50_000, y: 50_000, width: 10, height: 10 }, "W"),
      id: "far",
    });

    const renderer = new Renderer(fakeCtx(), scene, { x: 0, y: 0, zoom: 1 }, { width: 800, height: 600 });
    renderer.markDirty();

    expect(renderer.render()).toMatchObject({ drawn: 1, culled: 1 });
  });

  it("does not redraw when nothing is dirty", () => {
    const renderer = new Renderer(fakeCtx(), new Scene(), { x: 0, y: 0, zoom: 1 }, {
      width: 800,
      height: 600,
    });
    renderer.render();
    const first = renderer.stats.frameMs;

    renderer.render();
    expect(renderer.stats.frameMs).toBe(first);
  });

  it("redraws after the camera moves", () => {
    const scene = new Scene();
    scene.add({ ...createElement("rectangle", { x: 2000, y: 0, width: 10, height: 10 }, "V"), id: "offscreen" });

    const renderer = new Renderer(fakeCtx(), scene, { x: 0, y: 0, zoom: 1 }, { width: 800, height: 600 });
    expect(renderer.render()).toMatchObject({ drawn: 0, culled: 1 });

    renderer.setCamera({ x: -1900, y: 0, zoom: 1 });
    expect(renderer.render()).toMatchObject({ drawn: 1, culled: 0 });
  });

  it("counts a partially visible element as drawn", () => {
    const scene = new Scene();
    scene.add({ ...createElement("rectangle", { x: -20, y: -20, width: 100, height: 100 }, "V"), id: "straddle" });

    const renderer = new Renderer(fakeCtx(), scene, { x: 0, y: 0, zoom: 1 }, { width: 800, height: 600 });
    expect(renderer.render()).toMatchObject({ drawn: 1, culled: 0 });
  });

  it("paints the selection overlay and repaints only when selection changes", () => {
    const scene = new Scene();
    const el = createElement("rectangle", { x: 10, y: 10, width: 100, height: 80 }, "V");
    scene.add(el);

    const ctx = fakeCtx();
    const renderer = new Renderer(ctx, scene, { x: 0, y: 0, zoom: 1 }, {
      width: 800,
      height: 600,
      grid: false,
    });
    renderer.render();
    ctx.reset();

    renderer.setSelection([el]);
    renderer.render();
    // Eight edge handles plus the rotation handle.
    expect(ctx.calls.filter((call) => call === "arc")).toHaveLength(9);

    ctx.reset();
    renderer.setSelection([el]);
    renderer.render();
    expect(ctx.calls).toHaveLength(0);
  });

  it("paints the marquee while a selection box is being dragged", () => {
    const ctx = fakeCtx();
    const renderer = new Renderer(ctx, new Scene(), { x: 0, y: 0, zoom: 1 }, {
      width: 800,
      height: 600,
      grid: false,
    });
    renderer.render();
    ctx.reset();

    renderer.setMarquee({ x: 10, y: 10, width: 100, height: 50 });
    renderer.render();
    expect(ctx.calls).toContain("fillRect");

    ctx.reset();
    renderer.setMarquee({ x: 10, y: 10, width: 100, height: 50 });
    renderer.render();
    expect(ctx.calls).toHaveLength(0);
  });
});
