import type { Point } from "@penpaper/shared";

export type PointerKind = "mouse" | "pen" | "touch";

/**
 * The only pointer shape the engine understands.
 *
 * Raw `PointerEvent`s never cross this boundary: the shell flattens them here
 * so the engine stays testable without a DOM, and so every input path — mouse,
 * pen, finger, synthetic event in a test — is literally the same data.
 */
export interface PointerInput {
  id: number;
  type: PointerKind;
  /** CSS pixels, relative to the canvas. */
  x: number;
  y: number;
  /** 0–1. Mouse and touch report 0.5 unless the device says otherwise. */
  pressure: number;
  /**
   * The DOM button that started the press: 0 primary, 2 secondary.
   *
   * Optional so existing callers and tests keep working; when it is present,
   * a secondary press must never start ink.
   */
  button?: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

export interface WheelInput {
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

export function pointerToScene(
  camera: { x: number; y: number; zoom: number },
  input: PointerInput,
): Point {
  return {
    x: (input.x - camera.x) / camera.zoom,
    y: (input.y - camera.y) / camera.zoom,
  };
}
