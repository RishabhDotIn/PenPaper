import type { Element } from "@penpaper/shared";
import type { Scene } from "../scene/scene";

export interface Command {
  label: string;
  apply(scene: Scene): void;
  revert(scene: Scene): void;
}

/**
 * Adds one element, or brings a tombstoned one back.
 *
 * `revert` tombstones rather than removing the map entry: that is the same
 * rule the rest of the engine follows, and it keeps a redo able to restore the
 * exact element object it had before.
 */
export function addCommand(element: Element, label = "add"): Command {
  return {
    label,
    apply(scene) {
      scene.restore(element);
    },
    revert(scene) {
      scene.update(element.id, { isDeleted: true });
    },
  };
}

export function removeCommand(element: Element, label = "delete"): Command {
  return {
    label,
    apply(scene) {
      scene.update(element.id, { isDeleted: true });
    },
    revert(scene) {
      scene.restore(element);
    },
  };
}
