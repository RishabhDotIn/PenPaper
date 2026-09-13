import type { Element, Point } from "@penpaper/shared";
import type { Handle } from "./handles";

export interface ResizeOptions {
  keepAspect: boolean;
  fromCenter: boolean;
}

const MIN_SIZE = 1;

function rotate(p: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/**
 * Resize in the element's own frame, then rotate the result back.
 *
 * Doing the arithmetic in local coordinates is the only way a rotated element
 * resizes along its own edges instead of along the screen's; it also means the
 * same code path serves every handle.
 *
 * The caller passes the element as it was when the drag started, so every move
 * is computed from the original rather than compounding rounding errors.
 */
export function resizeElement(
  el: Element,
  handle: Handle,
  pointer: Point,
  opts: ResizeOptions,
): Partial<Element> {
  if (handle === "rotation") return {};

  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;

  const local = rotate({ x: pointer.x - cx, y: pointer.y - cy }, -el.angle);

  const originalLeft = -el.width / 2;
  const originalRight = el.width / 2;
  const originalTop = -el.height / 2;
  const originalBottom = el.height / 2;

  const movesLeft = handle === "nw" || handle === "w" || handle === "sw";
  const movesRight = handle === "ne" || handle === "e" || handle === "se";
  const movesTop = handle === "nw" || handle === "n" || handle === "ne";
  const movesBottom = handle === "sw" || handle === "s" || handle === "se";
  const movesX = movesLeft || movesRight;
  const movesY = movesTop || movesBottom;

  let left = originalLeft;
  let right = originalRight;
  let top = originalTop;
  let bottom = originalBottom;

  if (movesLeft) left = Math.min(local.x, right - MIN_SIZE);
  if (movesRight) right = Math.max(local.x, left + MIN_SIZE);
  if (movesTop) top = Math.min(local.y, bottom - MIN_SIZE);
  if (movesBottom) bottom = Math.max(local.y, top + MIN_SIZE);

  if (opts.fromCenter) {
    if (movesLeft) right = -left;
    if (movesRight) left = -right;
    if (movesTop) bottom = -top;
    if (movesBottom) top = -bottom;
  }

  let width = Math.max(MIN_SIZE, right - left);
  let height = Math.max(MIN_SIZE, bottom - top);

  if (opts.keepAspect) {
    const aspect = el.width / Math.max(MIN_SIZE, el.height);

    if (movesX && movesY) {
      // Corner: follow whichever axis the pointer pushed further.
      if (width / height > aspect) height = width / aspect;
      else width = height * aspect;
    } else if (movesX) {
      height = width / aspect;
    } else if (movesY) {
      width = height * aspect;
    }
  }

  // The point that must not move: the edge opposite the grabbed handle, or the
  // centre when the user holds Alt.
  const anchorX = opts.fromCenter
    ? 0
    : movesLeft
      ? originalRight
      : movesRight
        ? originalLeft
        : 0;
  const anchorY = opts.fromCenter
    ? 0
    : movesTop
      ? originalBottom
      : movesBottom
        ? originalTop
        : 0;

  const localCentre = opts.fromCenter
    ? { x: 0, y: 0 }
    : {
        x: movesLeft ? anchorX - width / 2 : movesRight ? anchorX + width / 2 : 0,
        y: movesTop ? anchorY - height / 2 : movesBottom ? anchorY + height / 2 : 0,
      };

  const worldCentre = rotate(localCentre, el.angle);

  return {
    x: cx + worldCentre.x - width / 2,
    y: cy + worldCentre.y - height / 2,
    width,
    height,
  };
}

export interface RotateOptions {
  snap: boolean;
}

const SNAP_STEP = Math.PI / 12; // 15°
const HALF_PI = Math.PI / 2;

export function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = angle % twoPi;
  return wrapped < 0 ? wrapped + twoPi : wrapped;
}

/**
 * Angle from the element centre to the pointer, with optional 15° snapping.
 *
 * The rotation handle rests directly above the centre, i.e. at −90°. Measuring
 * from that rest direction instead of from +x means grabbing the handle of an
 * untouched element produces the angle it already had; without the +90° term
 * the element would snap a quarter turn the instant it was grabbed.
 */
export function rotateElement(
  el: Element,
  pointer: Point,
  opts: RotateOptions,
): Partial<Element> {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;

  let angle = Math.atan2(pointer.y - cy, pointer.x - cx) + HALF_PI;

  if (opts.snap) {
    angle = Math.round(angle / SNAP_STEP) * SNAP_STEP;
  }

  return { angle: normalizeAngle(angle) };
}
