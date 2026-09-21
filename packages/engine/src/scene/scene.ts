import type { Bounds, Element } from "@penpaper/shared";

/**
 * The in-memory set of elements for one board.
 *
 * Insertion order is irrelevant: paint order comes from the fractional
 * `index`, so a reorder is a single field write rather than a list rebuild.
 *
 * Deletion is a tombstone (`isDeleted`), never a `Map.delete`. Tombstones are
 * what let an undo restore an element, and what stop a stale replica from
 * resurrecting one during a collaborative merge.
 */
export class Scene {
  private readonly elements = new Map<string, Element>();
  private revisionCounter = 0;

  /**
   * Bumped on every mutation.
   *
   * The renderer compares this against the revision it last painted, so any
   * caller that changes the scene gets a repaint without having to remember a
   * separate `markDirty()` call. Missing one of those calls is exactly how a
   * live stroke becomes invisible until the pointer is released.
   */
  get revision(): number {
    return this.revisionCounter;
  }

  get size(): number {
    let live = 0;
    for (const element of this.elements.values()) if (!element.isDeleted) live += 1;
    return live;
  }

  add(element: Element): void {
    if (this.elements.has(element.id)) {
      throw new Error(`Scene.add: element "${element.id}" already exists`);
    }
    this.elements.set(element.id, element);
    this.revisionCounter += 1;
  }

  /** Replaces recognised fields, bumps `version`, stamps `updatedAt`. */
  update(id: string, patch: Partial<Element>): void {
    const current = this.elements.get(id);
    if (!current) return;

    this.elements.set(id, {
      ...current,
      ...patch,
      // The identity of an element is not patchable, and neither is history.
      id: current.id,
      version: current.version + 1,
      updatedAt: Date.now(),
    });
    this.revisionCounter += 1;
  }

  /** Tombstones the element so it can be undone and merged. */
  remove(id: string): void {
    this.update(id, { isDeleted: true });
  }

  get(id: string): Element | undefined {
    return this.elements.get(id);
  }

  /**
   * A shallow copy of the map, for history.
   *
   * Elements are treated as immutable values — every mutation replaces the
   * object — so a snapshot costs one Map allocation, not a deep clone.
   */
  snapshot(): Map<string, Element> {
    return new Map(this.elements);
  }

  /** Puts an exact element back, bypassing the version/updatedAt stamping. */
  restore(element: Element): void {
    this.elements.set(element.id, element);
    this.revisionCounter += 1;
  }

  /** Live elements, back to front. */
  ordered(): Element[] {
    const live: Element[] = [];
    for (const element of this.elements.values()) {
      if (!element.isDeleted) live.push(element);
    }
    return live.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
  }

  /** Axis-aligned union of live element boxes, ignoring rotation. */
  bounds(): Bounds | null {
    const live = this.ordered();
    const first = live[0];
    if (!first) return null;

    let minX = first.x;
    let minY = first.y;
    let maxX = first.x + first.width;
    let maxY = first.y + first.height;

    for (const element of live) {
      minX = Math.min(minX, element.x);
      minY = Math.min(minY, element.y);
      maxX = Math.max(maxX, element.x + element.width);
      maxY = Math.max(maxY, element.y + element.height);
    }

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
}
