export type InteractionState =
  | "idle"
  | "panning"
  | "selecting"
  | "dragging"
  | "resizing"
  | "rotating"
  | "drawing"
  | "lasering"
  | "editingText"
  | "erasing";

/**
 * Explicit transitions rather than a pile of booleans.
 *
 * Every "why is the cursor stuck as a resize arrow" bug starts life as two
 * flags that disagree. This table makes an impossible state a thrown error in
 * development and a no-op in production.
 */
const TRANSITIONS: Record<InteractionState, readonly InteractionState[]> = {
  idle: ["panning", "selecting", "dragging", "drawing", "lasering", "editingText", "erasing"],
  panning: ["idle"],
  selecting: ["dragging", "idle"],
  dragging: ["resizing", "rotating", "idle"],
  resizing: ["dragging", "idle"],
  rotating: ["dragging", "idle"],
  drawing: ["idle"],
  lasering: ["idle"],
  editingText: ["idle"],
  erasing: ["idle"],
};

export class InteractionFSM {
  private current: InteractionState;

  constructor(initial: InteractionState = "idle") {
    this.current = initial;
  }

  get state(): InteractionState {
    return this.current;
  }

  transition(next: InteractionState): void {
    if (next === this.current) return;

    if (!TRANSITIONS[this.current].includes(next)) {
      if (process.env.NODE_ENV !== "production") {
        throw new Error(`illegal transition: ${this.current} → ${next}`);
      }
      return;
    }

    this.current = next;
  }

  /** Used by tests and by pointer-cancel, which must always reach idle. */
  reset(): void {
    this.current = "idle";
  }
}
