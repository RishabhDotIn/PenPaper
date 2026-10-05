import { laserStrength, type LaserPoint } from "../laser";
import { sceneToScreen, type Camera } from "../math/camera";

/**
 * The laser pointer's colour.
 *
 * Red on purpose: it reads as "this is a gesture, not ink" against every paper
 * colour and every ink colour PenPaper offers, and it is what presentation
 * apps have trained people to expect.
 */
const LASER_INK = "#ff3b30";

/**
 * Paints the trail in screen space so its width does not change with zoom.
 *
 * One stroke per segment, each aged by its own timestamp: that is what makes
 * the head solid and the tail dissolve instead of the whole line pulsing.
 * The glow is a single pass over the newest points, which keeps the cost flat
 * while still looking lit.
 */
export function drawLaserTrail(
  ctx: CanvasRenderingContext2D,
  points: readonly LaserPoint[],
  camera: Camera,
  now: number,
): void {
  if (points.length === 0) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = LASER_INK;
  ctx.fillStyle = LASER_INK;

  const screen = points.map((point) => ({
    ...sceneToScreen(camera, point),
    strength: laserStrength(point, now),
  }));

  // Glow first: wide, faint, only where the trail is still strong.
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 11;
  ctx.beginPath();
  let glowing = false;
  for (const point of screen) {
    if (point.strength < 0.35) {
      glowing = false;
      continue;
    }
    if (glowing) ctx.lineTo(point.x, point.y);
    else ctx.moveTo(point.x, point.y);
    glowing = true;
  }
  if (glowing) ctx.stroke();

  // Then the head of the trail, segment by segment.
  for (let index = 1; index < screen.length; index += 1) {
    const from = screen[index - 1];
    const to = screen[index];
    if (!from || !to) continue;

    const strength = Math.max(from.strength, to.strength);
    if (strength <= 0.02) continue;

    ctx.globalAlpha = Math.min(1, strength * 1.15);
    ctx.lineWidth = 1.6 + strength * 2.6;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  // A tap, or the head of a very short stroke, is a dot rather than a line.
  const head = screen[screen.length - 1];
  if (head && head.strength > 0.02 && screen.length === 1) {
    ctx.globalAlpha = Math.min(1, head.strength * 1.15);
    ctx.beginPath();
    ctx.arc(head.x, head.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
