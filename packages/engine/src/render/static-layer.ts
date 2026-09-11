/**
 * The static layer: grid and other expensive-to-redraw content.
 *
 * Panning repaints the visible region every frame, but the grid only changes
 * when the camera or the viewport does. Painting it once into an offscreen
 * surface and blitting a bitmap keeps a pan at one composite instead of
 * hundreds of line segments.
 */

export interface StaticLayer {
  readonly context: CanvasRenderingContext2D | null;
  resize(width: number, height: number, dpr: number): void;
  clear(): void;
  draw(paint: (ctx: CanvasRenderingContext2D) => void): void;
  blitTo(target: CanvasRenderingContext2D, width: number, height: number): void;
  readonly size: { width: number; height: number; dpr: number };
}

type CanvasSurface = {
  width: number;
  height: number;
  getContext(id: "2d"): CanvasRenderingContext2D | null;
};

function createSurface(width: number, height: number): CanvasSurface | null {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height) as unknown as CanvasSurface;
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

class CanvasStaticLayer implements StaticLayer {
  private surface: CanvasSurface | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private state = { width: 0, height: 0, dpr: 0 };

  get context(): CanvasRenderingContext2D | null {
    return this.ctx;
  }

  get size() {
    return this.state;
  }

  resize(width: number, height: number, dpr: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));

    if (this.state.width === w && this.state.height === h && this.state.dpr === dpr) return;

    const surface = createSurface(Math.round(w * dpr), Math.round(h * dpr));
    this.surface = surface;
    this.ctx = surface?.getContext("2d") ?? null;
    this.state = { width: w, height: h, dpr };

    // Paint in CSS pixels so callers never think about the ratio.
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear(): void {
    if (!this.ctx) return;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.state.width * this.state.dpr, this.state.height * this.state.dpr);
    this.ctx.restore();
  }

  draw(paint: (ctx: CanvasRenderingContext2D) => void): void {
    if (!this.ctx) return;
    this.ctx.save();
    paint(this.ctx);
    this.ctx.restore();
  }

  blitTo(target: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.ctx || !this.surface) return;
    target.drawImage(
      this.surface as unknown as CanvasImageSource,
      0,
      0,
      this.state.width,
      this.state.height,
      0,
      0,
      width,
      height,
    );
  }
}

/** A layer that does nothing, for tests and for environments without canvas. */
class NullStaticLayer implements StaticLayer {
  readonly context = null;
  size = { width: 0, height: 0, dpr: 0 };
  resize(width: number, height: number, dpr: number): void {
    this.size = { width, height, dpr };
  }
  clear(): void {}
  draw(): void {}
  blitTo(): void {}
}

export function createStaticLayer(): StaticLayer {
  return typeof OffscreenCanvas !== "undefined" || typeof document !== "undefined"
    ? new CanvasStaticLayer()
    : new NullStaticLayer();
}
