import type { Scene } from "../scene/scene";
import type { Camera } from "../math/camera";
import { boundsIntersect, elementBounds } from "../math/bounds";
import { RoughCache } from "./rough-cache";
import { drawElement } from "./shapes";
import { createStaticLayer, type StaticLayer } from "./static-layer";
import { visibleBounds } from "./surface";
import { lightTheme, type Theme } from "./theme";

export interface RendererOptions {
  width: number;
  height: number;
  theme?: Theme;
  grid?: boolean;
  /** Grid spacing in scene units. */
  gridSize?: number;
  staticLayer?: StaticLayer;
}

export interface RenderStats {
  drawn: number;
  culled: number;
  frameMs: number;
}

const clock = (): number => globalThis.performance?.now?.() ?? Date.now();

/**
 * The render loop's body.
 *
 * Three layers, back to front: background, static grid, elements. Only the
 * element layer is repainted on every dirty frame; the grid is cached in an
 * offscreen surface and blitted, and an idle board does no work at all because
 * `render()` returns immediately when nothing marked the frame dirty.
 */
export class Renderer {
  private camera: Camera;
  private options: Required<Omit<RendererOptions, "staticLayer" | "theme">> & { theme: Theme };
  private readonly layer: StaticLayer;
  private readonly cache = new RoughCache();
  private dirty = true;
  private gridDirty = true;
  private frames: RenderStats = { drawn: 0, culled: 0, frameMs: 0 };

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly scene: Scene,
    camera: Camera,
    options: RendererOptions,
  ) {
    this.camera = camera;
    this.options = {
      width: options.width,
      height: options.height,
      theme: options.theme ?? lightTheme,
      grid: options.grid ?? true,
      gridSize: options.gridSize ?? 20,
    };
    this.layer = options.staticLayer ?? createStaticLayer();
    this.layer.resize(this.options.width, this.options.height, 1);
  }

  get stats(): RenderStats {
    return this.frames;
  }

  get theme(): Theme {
    return this.options.theme;
  }

  markDirty(): void {
    this.dirty = true;
  }

  setCamera(camera: Camera): void {
    if (
      camera.x === this.camera.x &&
      camera.y === this.camera.y &&
      camera.zoom === this.camera.zoom
    ) {
      return;
    }
    this.camera = camera;
    this.dirty = true;
    this.gridDirty = true;
  }

  setTheme(theme: Theme): void {
    this.options.theme = theme;
    this.dirty = true;
    this.gridDirty = true;
  }

  setGridEnabled(enabled: boolean): void {
    this.options.grid = enabled;
    this.dirty = true;
    this.gridDirty = true;
  }

  setSize(width: number, height: number, dpr = 1): void {
    if (this.options.width === width && this.options.height === height) return;
    this.options.width = width;
    this.options.height = height;
    this.layer.resize(width, height, dpr);
    this.dirty = true;
    this.gridDirty = true;
  }

  render(): RenderStats {
    // Nothing changed: keep the previous stats so `frameMs` reading steady is
    // itself the signal that we skipped the frame.
    if (!this.dirty) return this.frames;

    const started = clock();
    const { ctx } = this;
    const { theme, width, height } = this.options;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    if (this.options.grid) this.paintGrid();
    this.layer.blitTo(ctx, width, height);

    const view = visibleBounds(this.camera, { width, height }, 32);
    let drawn = 0;
    let culled = 0;

    ctx.save();
    ctx.translate(this.camera.x, this.camera.y);
    ctx.scale(this.camera.zoom, this.camera.zoom);

    for (const el of this.scene.ordered()) {
      if (!boundsIntersect(elementBounds(el), view)) {
        culled += 1;
        continue;
      }
      drawElement(ctx, el, this.cache, theme);
      drawn += 1;
    }

    ctx.restore();

    this.dirty = false;
    this.frames = { drawn, culled, frameMs: clock() - started };
    return this.frames;
  }

  private paintGrid(): void {
    if (!this.gridDirty) return;

    const { theme, width, height } = this.options;
    const spacing = this.options.gridSize * this.camera.zoom;

    // Below ~6 px the grid reads as a grey haze and costs real time.
    if (spacing < 6) {
      this.layer.clear();
      this.gridDirty = false;
      return;
    }

    this.layer.clear();
    this.layer.draw((g) => {
      g.strokeStyle = theme.grid;
      g.lineWidth = 1;
      g.beginPath();

      const startX = this.camera.x % spacing;
      for (let x = startX; x <= width; x += spacing) {
        const px = Math.round(x) + 0.5;
        g.moveTo(px, 0);
        g.lineTo(px, height);
      }

      const startY = this.camera.y % spacing;
      for (let y = startY; y <= height; y += spacing) {
        const py = Math.round(y) + 0.5;
        g.moveTo(0, py);
        g.lineTo(width, py);
      }

      g.stroke();
    });

    this.gridDirty = false;
  }
}
