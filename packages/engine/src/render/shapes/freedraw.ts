import type { Element } from "@penpaper/shared";
import { getStroke } from "perfect-freehand";

export interface FreedrawOptions {
  /** Sizes are in scene units, so zooming does not thicken the line. */
  size?: number;
  thinning?: number;
  smoothing?: number;
  streamline?: number;
  simulatePressure?: boolean;
}

/**
 * Perfect-freehand returns the outline of a variable-width stroke, not a
 * centre line. Filling it is what produces the ink feel; stroking it would
 * give a hollow capsule.
 */
export function freedrawOutline(
  points: readonly number[][],
  options: FreedrawOptions = {},
): number[][] {
  const input = points.map((p) => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0.5] as [number, number, number]);
  if (input.length === 0) return [];

  return getStroke(input, {
    size: options.size ?? 4,
    thinning: options.thinning ?? 0.6,
    smoothing: options.smoothing ?? 0.5,
    streamline: options.streamline ?? 0.5,
    simulatePressure: options.simulatePressure ?? true,
    last: true,
  });
}

const midpoint = (a: readonly number[], b: readonly number[]): [number, number] => [
  ((a[0] ?? 0) + (b[0] ?? 0)) / 2,
  ((a[1] ?? 0) + (b[1] ?? 0)) / 2,
];

/**
 * Traces the outline as quadratic curves through point midpoints.
 *
 * Straight `lineTo` between raw outline samples leaves visible facets and, on
 * a fast flick where samples are far apart, thin triangular whiskers at the
 * turn — the outline crosses itself and the nonzero fill rule paints the
 * overhang. Curving through the midpoints keeps the same silhouette without
 * the spikes, which is how perfect-freehand's output is meant to be drawn.
 */
export function traceOutline(ctx: CanvasRenderingContext2D, outline: readonly number[][]): void {
  if (outline.length < 3) return;

  const first = outline[0];
  const last = outline[outline.length - 1];
  if (!first || !last) return;

  const start = midpoint(last, first);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);

  for (let i = 0; i < outline.length; i += 1) {
    const current = outline[i];
    const next = outline[(i + 1) % outline.length];
    if (!current || !next) continue;
    const end = midpoint(current, next);
    ctx.quadraticCurveTo(current[0] ?? 0, current[1] ?? 0, end[0], end[1]);
  }

  ctx.closePath();
}

export function drawFreedraw(ctx: CanvasRenderingContext2D, el: Element): void {
  // A single tap is a dot, not an empty path.
  if (el.points.length === 1) {
    const only = el.points[0];
    ctx.beginPath();
    ctx.arc(only?.[0] ?? 0, only?.[1] ?? 0, Math.max(1.5, el.strokeWidth), 0, Math.PI * 2);
    ctx.fillStyle = el.strokeColor;
    ctx.fill();
    return;
  }

  const outline = freedrawOutline(el.points, {
    size: el.strokeWidth * 2,
    simulatePressure: el.simulatePressure,
  });
  if (outline.length < 3) return;

  traceOutline(ctx, outline);
  ctx.fillStyle = el.strokeColor;
  ctx.fill();
}
