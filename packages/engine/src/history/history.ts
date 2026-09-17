import type { Element } from "@penpaper/shared";
import type { Scene } from "../scene/scene";
import type { Command } from "./commands";

const DEFAULT_LIMIT = 100;

/**
 * Undo and redo as transactions, not individual field writes.
 *
 * A drag emits dozens of `Scene.update` calls; without coalescing, undo would
 * step back one pointer sample at a time. The controller calls `begin` on
 * pointer-down and `commit` on pointer-up, so one gesture is one undo step no
 * matter how many frames it took.
 */
export class History {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];

  private pending: { label: string; before: Map<string, Element> } | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly limit = DEFAULT_LIMIT,
  ) {}

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Starts a transaction, committing anything already open. */
  begin(label: string): void {
    if (this.pending) this.commit();
    this.pending = { label, before: this.scene.snapshot() };
  }

  /** Diffs against the snapshot and records a command if anything changed. */
  commit(): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;

    const after = this.scene.snapshot();
    const beforeChanged = new Map<string, Element | undefined>();
    const afterChanged = new Map<string, Element | undefined>();

    for (const [id, beforeElement] of pending.before) {
      const afterElement = after.get(id);
      if (afterElement !== beforeElement) {
        beforeChanged.set(id, beforeElement);
        afterChanged.set(id, afterElement);
      }
    }

    for (const [id, afterElement] of after) {
      if (!pending.before.has(id)) {
        beforeChanged.set(id, undefined);
        afterChanged.set(id, afterElement);
      }
    }

    if (beforeChanged.size === 0) return;

    this.record({
      label: pending.label,
      apply: (scene) => restore(scene, afterChanged),
      revert: (scene) => restore(scene, beforeChanged),
    });
  }

  /** Drops the open transaction, e.g. when a stroke is cancelled. */
  cancel(): void {
    this.pending = null;
  }

  push(command: Command): void {
    this.record(command);
  }

  undo(): boolean {
    if (this.pending) this.commit();

    const command = this.undoStack.pop();
    if (!command) return false;

    command.revert(this.scene);
    this.redoStack.push(command);
    return true;
  }

  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;

    command.apply(this.scene);
    this.undoStack.push(command);
    return true;
  }

  clear(): void {
    this.pending = null;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  private record(command: Command): void {
    this.undoStack.push(command);
    // A new edit invalidates a redo branch; keeping it would let redo apply a
    // command that no longer follows from the current scene.
    this.redoStack.length = 0;

    if (this.undoStack.length > this.limit) this.undoStack.shift();
  }
}

/**
 * Applies a set of element states. `undefined` means "the element did not
 * exist at that point", which is represented as a tombstone.
 */
function restore(scene: Scene, states: Map<string, Element | undefined>): void {
  for (const [id, element] of states) {
    if (element) scene.restore(element);
    else scene.update(id, { isDeleted: true });
  }
}
