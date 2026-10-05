/**
 * The eraser's gesture, as opposed to the scene.
 *
 * Deleting an element is immediate and undoable. What this module describes is
 * the short life after that: the element shrinking away, and the soft trail the
 * eraser leaves as it moves. None of it is saved or synced.
 */

import type { Element, Point } from "@penpaper/shared";
import type { LaserPoint } from "./laser";

/** How long an erased element takes to shrink and fade out. */
export const ERASER_GHOST_MS = 220;

/** How long the soft trail behind the eraser stays visible. */
export const ERASER_TRAIL_FADE_MS = 320;

/** New trail samples closer than this are dropped. */
export const ERASER_TRAIL_MIN_STEP = 2;

/** A long scribble is capped so the fading frame stays cheap. */
export const ERASER_TRAIL_MAX_POINTS = 160;

/** Radius of the ring cursor, in screen pixels. */
export const ERASER_CURSOR_RADIUS = 11;

/** A snapshot of an element at the instant it was erased. */
export interface EraserGhost {
  element: Element;
  /** `laserClock()` timestamp of the erase. */
  t: number;
}

export interface EraserFrame {
  /** Scene point of the ring cursor, or null when the pointer left the board. */
  cursor: Point | null;
  trail: readonly LaserPoint[];
  ghosts: readonly EraserGhost[];
}

export const EMPTY_ERASER_FRAME: EraserFrame = { cursor: null, trail: [], ghosts: [] };

/** Remaining strength of a trail sample, 1 at the head and 0 once faded. */
export function eraserTrailStrength(point: LaserPoint, now: number): number {
  const age = now - point.t;
  if (age >= ERASER_TRAIL_FADE_MS) return 0;
  const remaining = 1 - age / ERASER_TRAIL_FADE_MS;
  return remaining * remaining;
}

/** How far an erased element has travelled toward disappearing, 0…1. */
export function eraserGhostProgress(ghost: EraserGhost, now: number): number {
  return Math.min(1, Math.max(0, (now - ghost.t) / ERASER_GHOST_MS));
}
