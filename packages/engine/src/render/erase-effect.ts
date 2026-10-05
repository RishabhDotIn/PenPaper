import {
  ERASER_CURSOR_RADIUS,
  ERASER_GHOST_MS,
  eraserGhostProgress,
  eraserTrailStrength,
  type EraserFrame,
  type EraserGhost,
} from "../eraser";
import { sceneToScreen, type Camera } from "../math/camera";
import type { RoughCache } from "./rough-cache";
import { drawElement } from "./shapes";
import type { Theme } from "./theme";

const TRAIL_INK = "#7b7b86";

/**
 * Erased elements leaving the board.
 *
 * Drawn inside the camera transform, where the scene lives, so the ghost stays
 * glued to the paper while the camera moves. `drawElement` writes its own
 * opacity from the element, so the fade is applied to the copy's opacity rather
 * than to `ctx.globalAlpha` (which would be overwritten).
 */
export function drawEraseGhosts(
  ctx: CanvasRenderingContext2D,
  ghosts: readonly EraserGhost[],
  cache: RoughCache,
  theme: Theme,
  now: number,
): void {
  for (const ghost of ghosts) {
    const progress = eraserGhostProgress(ghost, now);
    if (progress >= 1) continue;

    const element = ghost.element;
    const remaining = 1 - progress;
    // A quick collapse, not a fade in place: the eye reads it as the eraser
    // taking the shape away, and the board is clear in under a quarter second.
    const scale = 1 - 0.08 * progress;
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    drawElement(ctx, { ...element, opacity: element.opacity * remaining * remaining }, cache, theme);
    ctx.restore();
  }
}

/**
 * The eraser's own marks: a soft trail and the ring under the pointer.
 *
 * Both are screen-space and painted after the scene, for the same reason the
 * laser is: the ring must stay the same size at every zoom, and neither may
 * become part of the board.
 */
export function drawEraserOverlay(
  ctx: CanvasRenderingContext2D,
  frame: EraserFrame,
  camera: Camera,
  now: number,
): void {
  drawTrail(ctx, frame, camera, now);
  drawCursor(ctx, frame, camera);
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  frame: EraserFrame,
  camera: Camera,
  now: number,
): void {
  if (frame.trail.length < 2) return;

  const screen = frame.trail.map((point) => ({
    ...sceneToScreen(camera, point),
    strength: eraserTrailStrength(point, now),
  }));

  ctx.save();
  // Butt caps, not round: neighbouring segments share an endpoint, and two
  // round caps at the same point double the alpha into a visible bead. The
  // trail must read as one smooth smear, not a string of dots.
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  ctx.strokeStyle = TRAIL_INK;

  for (let index = 1; index < screen.length; index += 1) {
    const from = screen[index - 1];
    const to = screen[index];
    if (!from || !to) continue;

    const strength = Math.min(from.strength, to.strength);
    if (strength <= 0.02) continue;

    ctx.globalAlpha = 0.2 * strength;
    ctx.lineWidth = 12 + strength * 5;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawCursor(
  ctx: CanvasRenderingContext2D,
  frame: EraserFrame,
  camera: Camera,
): void {
  if (!frame.cursor) return;
  const point = sceneToScreen(camera, frame.cursor);

  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, ERASER_CURSOR_RADIUS, 0, Math.PI * 2);
  // White enough to read on both paper and a dark board; the dark hairline is
  // what keeps it from vanishing into a light canvas.
  ctx.fillStyle = "rgba(255, 255, 255, 0.58)";
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "rgba(32, 32, 40, 0.55)";
  ctx.stroke();
  ctx.restore();
}

/** True while a ghost still needs a frame. */
export function eraseGhostsActive(ghosts: readonly EraserGhost[], now: number): boolean {
  const newest = ghosts[ghosts.length - 1];
  return Boolean(newest && now - newest.t < ERASER_GHOST_MS + 80);
}
