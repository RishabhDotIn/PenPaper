import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene";
import { createElement } from "../scene/factory";
import { fakeCtx } from "../test/fake-ctx";
import { Renderer } from "./renderer";
import type { StaticLayer } from "./static-layer";

/**
 * A grid layer whose paint callback runs into a recording context. jsdom has no
 * rasteriser, so without this the pattern branch would be untestable.
 */
function fakeLayer(): StaticLayer & { paints: number; clears: number; ctx: ReturnType<typeof fakeCtx> } {
  const ctx = fakeCtx();
  return {
    context: ctx,
    ctx,
    size: { width: 0, height: 0, dpr: 0 },
    paints: 0,
    clears: 0,
    resize() {},
    clear() {
      this.clears += 1;
    },
    draw(paint) {
      this.paints += 1;
      paint(ctx);
    },
    blitTo() {},
  };
}

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

  it("repaints when the scene changes, without an explicit markDirty", () => {
    const scene = new Scene();
    const renderer = new Renderer(fakeCtx(), scene, { x: 0, y: 0, zoom: 1 }, {
      width: 800,
      height: 600,
      grid: false,
    });
    expect(renderer.render()).toMatchObject({ drawn: 0 });

    scene.add(createElement("rectangle", { x: 10, y: 10, width: 20, height: 20 }, "V"));
    expect(renderer.render()).toMatchObject({ drawn: 1 });
  });

  it("clears the whole backing store on a high-DPI canvas", () => {
    const ctx = fakeCtx();
    // The backing store is 800 × 600 for a 400 × 300 CSS viewport at 2×.
    const renderer = new Renderer(ctx, new Scene(), { x: 0, y: 0, zoom: 1 }, {
      width: 400,
      height: 300,
    });
    renderer.render();

    const fill = ctx.records.find((record) => record.name === "fillRect");
    expect(fill?.args.slice(0, 4)).toEqual([0, 0, 800, 600]);
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

  it("paints dots, not lines, for the dotted layout", () => {
    const layer = fakeLayer();
    const renderer = new Renderer(fakeCtx(), new Scene(), { x: 0, y: 0, zoom: 1 }, {
      width: 200,
      height: 200,
      pattern: "dots",
      staticLayer: layer,
    });

    renderer.render();

    expect(layer.paints).toBe(1);
    expect(layer.ctx.calls).toContain("arc");
    expect(layer.ctx.calls).toContain("fill");
    expect(layer.ctx.calls).not.toContain("lineTo");
  });

  it("paints ruled lines for the box layout", () => {
    const layer = fakeLayer();
    const renderer = new Renderer(fakeCtx(), new Scene(), { x: 0, y: 0, zoom: 1 }, {
      width: 200,
      height: 200,
      pattern: "lines",
      staticLayer: layer,
    });

    renderer.render();

    expect(layer.paints).toBe(1);
    expect(layer.ctx.calls).toContain("stroke");
    expect(layer.ctx.calls).not.toContain("arc");
  });

  it("leaves the paper blank for the plain layout", () => {
    const layer = fakeLayer();
    const renderer = new Renderer(fakeCtx(), new Scene(), { x: 0, y: 0, zoom: 1 }, {
      width: 200,
      height: 200,
      pattern: "none",
      staticLayer: layer,
    });

    renderer.render();

    expect(layer.paints).toBe(0);
    expect(layer.clears).toBeGreaterThan(0);
  });

  it("repaints the grid when the layout changes", () => {
    const layer = fakeLayer();
    const renderer = new Renderer(fakeCtx(), new Scene(), { x: 0, y: 0, zoom: 1 }, {
      width: 200,
      height: 200,
      pattern: "none",
      staticLayer: layer,
    });
    renderer.render();
    expect(layer.paints).toBe(0);

    renderer.setPattern("lines");
    renderer.render();
    expect(layer.paints).toBe(1);
  });

  it("fills the board with a custom background colour", () => {
    const ctx = fakeCtx();
    const renderer = new Renderer(ctx, new Scene(), { x: 0, y: 0, zoom: 1 }, {
      width: 200,
      height: 200,
      background: "#fff9db",
      staticLayer: fakeLayer(),
    });

    renderer.render();

    const fill = ctx.records.find((record) => record.name === "fillRect");
    expect(fill).toBeDefined();
    expect(ctx.fillStyle).toBe("#fff9db");
  });

  it("exports a PNG without the selection overlay, then restores it", () => {
    const scene = new Scene();
    const el = createElement("rectangle", { x: 10, y: 10, width: 100, height: 80 }, "V");
    scene.add(el);

    const ctx = fakeCtx();
    const renderer = new Renderer(ctx, scene, { x: 0, y: 0, zoom: 1 }, {
      width: 800,
      height: 600,
      grid: false,
    });
    renderer.setSelection([el]);
    renderer.render();

    ctx.reset();
    expect(renderer.toDataUrl()).toBe("data:image/png;base64,stub");
    // Eight handles and the rotation handle would be painted for a selection.
    expect(ctx.calls.filter((call) => call === "arc")).toHaveLength(0);

    ctx.reset();
    renderer.render();
    expect(ctx.calls.filter((call) => call === "arc")).toHaveLength(9);
  });
});
