import type { PointerInput } from "./pointer";

/**
 * Decides whether a pointer stream is one finger or a gesture.
 *
 * The moment a second finger lands, the in-progress stroke is cancelled rather
 * than finished — a pinch always starts as an accidental line otherwise, and
 * that stray mark is the most common complaint about browser whiteboards.
 */
export class GestureArbiter {
  private readonly pointers = new Set<number>();

  /** Distance and midpoint of the first two pointers, for pinch maths. */
  private first: { id: number; x: number; y: number } | null = null;
  private second: { id: number; x: number; y: number } | null = null;

  get active(): number {
    return this.pointers.size;
  }

  pointerDown(e: PointerInput, _time: number): "single" | "multi" {
    this.pointers.add(e.id);
    if (this.pointers.size === 1) {
      this.first = { id: e.id, x: e.x, y: e.y };
      this.second = null;
    } else if (this.pointers.size === 2) {
      this.second = { id: e.id, x: e.x, y: e.y };
    }
    return this.pointers.size === 1 ? "single" : "multi";
  }

  pointerMove(e: PointerInput): void {
    if (this.first?.id === e.id) this.first = { ...this.first, x: e.x, y: e.y };
    if (this.second?.id === e.id) this.second = { ...this.second, x: e.x, y: e.y };
  }

  pointerUp(e: PointerInput): void {
    this.pointers.delete(e.id);
    if (this.first?.id === e.id) this.first = this.second;
    if (this.second?.id === e.id) this.second = null;
  }

  reset(): void {
    this.pointers.clear();
    this.first = null;
    this.second = null;
  }

  /** Pinch state: distance and midpoint, or null when fewer than two pointers. */
  pinch(): { distance: number; midpoint: { x: number; y: number } } | null {
    if (!this.first || !this.second) return null;

    const dx = this.second.x - this.first.x;
    const dy = this.second.y - this.first.y;
    return {
      distance: Math.hypot(dx, dy),
      midpoint: { x: (this.first.x + this.second.x) / 2, y: (this.first.y + this.second.y) / 2 },
    };
  }
}
