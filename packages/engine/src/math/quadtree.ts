import type { Bounds } from "@penpaper/shared";

/**
 * A quadtree over element bounds, rebuilt on every structural change.
 *
 * It exists for two hot paths: viewport culling in the renderer, and hit
 * testing on a 2 000-element board. Rebuilding is O(n log n) and happens once
 * per edit, while queries run 60× a second — the right side of that trade for
 * an editor that is idle far more often than it is drawing.
 */

interface Item {
  id: string;
  bounds: Bounds;
}

interface QuadNode {
  bounds: Bounds;
  depth: number;
  items: Item[];
  children: QuadNode[] | null;
}

const DEFAULT_MAX_ITEMS = 8;
const DEFAULT_MAX_DEPTH = 6;

function intersects(a: Bounds, b: Bounds): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function contains(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export class Quadtree {
  private root: QuadNode;
  private readonly maxItems: number;
  private readonly maxDepth: number;
  private count = 0;

  constructor(bounds: Bounds, maxItems = DEFAULT_MAX_ITEMS, maxDepth = DEFAULT_MAX_DEPTH) {
    this.maxItems = maxItems;
    this.maxDepth = maxDepth;
    this.root = { bounds, depth: 0, items: [], children: null };
  }

  get size(): number {
    return this.count;
  }

  insert(id: string, bounds: Bounds): void {
    this.count += 1;
    this.insertInto(this.root, { id, bounds });
  }

  query(area: Bounds): string[] {
    const found: string[] = [];

    const walk = (node: QuadNode): void => {
      if (!intersects(node.bounds, area)) return;
      for (const item of node.items) {
        if (intersects(item.bounds, area)) found.push(item.id);
      }
      if (node.children) for (const child of node.children) walk(child);
    };

    walk(this.root);
    return found;
  }

  clear(): void {
    this.root = { bounds: this.root.bounds, depth: 0, items: [], children: null };
    this.count = 0;
  }

  private insertInto(node: QuadNode, item: Item): void {
    if (node.children) {
      const child = this.childContaining(node.children, item.bounds);
      if (child) {
        this.insertInto(child, item);
        return;
      }
    }

    node.items.push(item);

    if (!node.children && node.items.length > this.maxItems && node.depth < this.maxDepth) {
      this.subdivide(node);
    }
  }

  private childContaining(children: QuadNode[], bounds: Bounds): QuadNode | null {
    for (const child of children) {
      if (contains(child.bounds, bounds)) return child;
    }
    return null;
  }

  private subdivide(node: QuadNode): void {
    const { x, y, width, height } = node.bounds;
    const halfW = width / 2;
    const halfH = height / 2;
    if (halfW <= 0 || halfH <= 0) return;

    const depth = node.depth + 1;
    node.children = [
      { bounds: { x, y, width: halfW, height: halfH }, depth, items: [], children: null },
      { bounds: { x: x + halfW, y, width: halfW, height: halfH }, depth, items: [], children: null },
      { bounds: { x, y: y + halfH, width: halfW, height: halfH }, depth, items: [], children: null },
      {
        bounds: { x: x + halfW, y: y + halfH, width: halfW, height: halfH },
        depth,
        items: [],
        children: null,
      },
    ];

    const retained: Item[] = [];
    for (const item of node.items) {
      const child = this.childContaining(node.children, item.bounds);
      if (child) this.insertInto(child, item);
      else retained.push(item);
    }
    node.items = retained;
  }
}
