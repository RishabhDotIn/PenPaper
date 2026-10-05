/**
 * The laser pointer's trail.
 *
 * Deliberately not part of the scene: it is a gesture, not ink. Nothing here
 * is saved, synced, or undoable, so a person can wave at the board during a
 * demo without leaving anything behind.
 */

export interface LaserPoint {
  /** Scene coordinates, so the trail stays put while the camera moves. */
  x: number;
  y: number;
  /** `laserClock()` timestamp of when the pointer was here. */
  t: number;
}

/**
 * How long a trail takes to fade out completely.
 *
 * Long enough to read a circle drawn quickly, short enough that the board is
 * clear by the time the next sentence starts. GoodNotes' trail lands in the
 * same range.
 */
export const LASER_FADE_MS = 850;

/** New samples closer than this are dropped; a jittery pen is not a trail. */
export const LASER_MIN_STEP = 2;

/** A long scribble is capped so the fade never costs a full second of work. */
export const LASER_MAX_POINTS = 320;

/**
 * One clock for both the controller (which stamps points) and the renderer
 * (which ages them). `performance.now()` is monotonic and survives the clock
 * changes that would make a wall-clock trail jump or stick.
 */
export const laserClock = (): number => globalThis.performance?.now?.() ?? Date.now();

/** A point younger than the fade window, with its remaining strength. */
export function laserStrength(point: LaserPoint, now: number): number {
  const age = now - point.t;
  if (age >= LASER_FADE_MS) return 0;
  // Ease out: the newest ink is solid, the tail is a whisper rather than a
  // linear ramp, which reads as motion instead of a fading line.
  const remaining = 1 - age / LASER_FADE_MS;
  return remaining * remaining;
}
