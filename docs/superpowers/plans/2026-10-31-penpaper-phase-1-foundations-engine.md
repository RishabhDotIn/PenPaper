# PenPaper Phase 1 — Foundations and Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed, installable whiteboard where a person on a phone, tablet, or laptop can draw, style, undo, and reload a board that persists locally.

**Architecture:** A framework-agnostic TypeScript canvas engine (`packages/engine`) driven by a thin React shell (`apps/web`). The engine owns the scene, the camera, hit-testing, rendering, input, and history; React owns layout and panels. Nothing in the engine imports React or Next.

**Tech Stack:** Next.js 16.4, React 19.3, TypeScript 7.0, Tailwind 4.3, Zustand 5, rough.js 4.6, perfect-freehand 1.2, idb 8, Vitest 5, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-31-penpaper-design.md`

## Global Constraints

- Node 22 LTS, pnpm workspaces. No npm/yarn lockfiles committed.
- Next.js `16.4.x`, React `19.3.x`, TypeScript `7.0.x` (fall back to `5.9.x` only if a tool breaks), Tailwind `4.3.x`.
- Engine package has **zero runtime dependencies except** `roughjs` and `perfect-freehand`. It must not import `react`, `next`, or touch `window` at module scope.
- Breakpoints: **768px** and **1024px**, exactly.
- Touch targets: **≥ 44×44 CSS px** whenever `(pointer: coarse)`.
- Max canvas DPR: **2** (tier A/B) and **1.5** (tier C).
- Palm rejection window: **800 ms** after the last pen event.
- Long-press context menu: **500 ms**.
- Autosave debounce: **500 ms**; flush on `visibilitychange` → `hidden`.
- Board caps: **2,000 elements**, **2 MB** serialised JSON.
- Board route JS budget: **≤ 220 KB gzipped**.
- Canvas height uses `100dvh`; all fixed chrome respects `env(safe-area-inset-*)`.
- Never set `user-scalable=no`; `touch-action: none` applies to the canvas element only.
- Every user-visible string is a plain English sentence. No lorem ipsum, no "TODO" in shipped UI.

## Review Focus

1. **Pinch on the canvas must zoom the board, never the page.** Test: task 9 dispatches a two-finger sequence and asserts `visualViewport.scale` is unchanged.
2. **Touch devices must never be offered hover-only affordances.** Test: task 11 runs at `hasTouch: true` and asserts resize handles appear on tap, with no `:hover` dependency.
3. **iOS must not zoom the page when a text element is focused.** Test: task 14 asserts the hidden textarea's computed `font-size` is ≥ 16px.
4. **Undo must never revert a partial drag or another person's edit.** Test: task 12 asserts one drag yields exactly one undo step and that undo after 50 mousemoves restores the original geometry in one call.
5. **A 1,000-element board must not collapse the frame rate.** Test: task 15 renders 1,000 elements and asserts median frame time ≤ 16 ms on the desktop project.

---

### Task 1: Monorepo, engine package, and CI

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/vitest.config.ts`
- Create: `packages/engine/src/index.ts`, `packages/engine/src/index.test.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `export const ENGINE_VERSION: string` from `packages/engine/src/index.ts`; workspace packages `@penpaper/engine`, `@penpaper/shared`, `@penpaper/ui`, `apps/web`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/src/index.test.ts
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "./index";

describe("engine package", () => {
  it("exposes a semver version string", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @penpaper/engine test`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Create the workspace and export the constant**

`pnpm-workspace.yaml` lists `apps/*` and `packages/*`. Root `package.json` is `private: true` with `"packageManager": "pnpm@10"` and a `test` script running `pnpm -r test`. Engine `package.json` is `"type": "module"`, `"main": "./src/index.ts"`, deps `roughjs` and `perfect-freehand`, dev deps `vitest` and `typescript`. `tsconfig.base.json` sets `strict`, `target: ES2023`, `module: ESNext`, `moduleResolution: bundler`, `noUncheckedIndexedAccess: true`. Export `ENGINE_VERSION = "0.1.0"`.

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm --filter @penpaper/engine test`
Expected: PASS, 1 test.

- [ ] **Step 5: Add CI and commit**

`.github/workflows/ci.yml` runs on push/PR: `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm -r test`, `pnpm --filter web build`.

```bash
git add .
git commit -m "chore: scaffold pnpm monorepo with engine package and CI"
```

---

### Task 2: Shared types, fractional index, and Scene

**Files:**
- Create: `packages/shared/src/elements.ts`, `packages/shared/src/index.ts`
- Create: `packages/engine/src/scene/fractional-index.ts`, `packages/engine/src/scene/fractional-index.test.ts`
- Create: `packages/engine/src/scene/scene.ts`, `packages/engine/src/scene/scene.test.ts`
- Create: `packages/engine/src/scene/factory.ts`

**Interfaces:**
- Produces: `Element`, `ElementType`, `Point`, `Bounds` (from `@penpaper/shared`); `indexBetween(a: string | null, b: string | null): string`; `class Scene { add(el): void; update(id, patch): void; remove(id): void; get(id): Element | undefined; ordered(): Element[]; bounds(): Bounds | null }`; `createElement(type: ElementType, at: Bounds, index: string): Element`.

- [ ] **Step 1: Write the failing tests**

```ts
// fractional-index.test.ts
import { describe, expect, it } from "vitest";
import { indexBetween } from "./fractional-index";

describe("indexBetween", () => {
  it("places a key strictly between two neighbours", () => {
    const a = indexBetween(null, null);
    const b = indexBetween(a, null);
    const c = indexBetween(a, b);
    expect(a < b).toBe(true);
    expect(a < c && c < b).toBe(true);
  });

  it("stays ordered across 200 random insertions", () => {
    let keys = [indexBetween(null, null)];
    for (let i = 0; i < 200; i++) {
      const at = Math.floor(Math.random() * (keys.length + 1));
      const key = indexBetween(keys[at - 1] ?? null, keys[at] ?? null);
      keys = [...keys.slice(0, at), key, ...keys.slice(at)];
    }
    const sorted = [...keys].sort();
    expect(sorted).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

```ts
// scene.test.ts
it("orders by index and skips deleted elements", () => {
  const scene = new Scene();
  scene.add({ ...createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, "V"), id: "b" });
  scene.add({ ...createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, "T"), id: "a" });
  scene.add({ ...createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, "W"), id: "c" });
  scene.remove("b");
  expect(scene.ordered().map((e) => e.id)).toEqual(["a", "c"]);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @penpaper/engine test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`fractional-index.ts` implements base-62 midpoint generation: given `a` and `b` (either may be null), return the lexicographically middle string, extending length by one digit when neighbours are adjacent. `Scene` holds `Map<string, Element>`; `ordered()` sorts by `index` with `localeCompare`-free `<` comparison and filters `isDeleted`. `update()` bumps `version` and `updatedAt`. `createElement` fills every default from the spec's element model, with `seed = Math.floor(Math.random() * 2 ** 31)`.

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm --filter @penpaper/engine test`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages && git commit -m "feat(engine): element types, fractional index, and scene"
```

---

### Task 3: Camera transforms and rotated bounds

**Files:**
- Create: `packages/engine/src/math/camera.ts`, `packages/engine/src/math/camera.test.ts`
- Create: `packages/engine/src/math/bounds.ts`, `packages/engine/src/math/bounds.test.ts`

**Interfaces:**
- Produces: `interface Camera { x: number; y: number; zoom: number }`; `screenToScene(camera: Camera, p: Point): Point`; `sceneToScreen(camera: Camera, p: Point): Point`; `zoomAt(camera: Camera, screenPoint: Point, factor: number, minZoom?: number, maxZoom?: number): Camera`; `elementBounds(el: Element): Bounds`; `boundsIntersect(a: Bounds, b: Bounds, margin?: number): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
it("round-trips screen and scene coordinates", () => {
  const camera = { x: -120, y: 40, zoom: 1.75 };
  const p = { x: 310, y: 220 };
  const back = sceneToScreen(camera, screenToScene(camera, p));
  expect(back.x).toBeCloseTo(p.x, 9);
  expect(back.y).toBeCloseTo(p.y, 9);
});

it("keeps the scene point under the cursor fixed while zooming", () => {
  const camera = { x: 0, y: 0, zoom: 1 };
  const cursor = { x: 400, y: 300 };
  const before = screenToScene(camera, cursor);
  const after = zoomAt(camera, cursor, 2);
  const stillThere = sceneToScreen(after, before);
  expect(stillThere.x).toBeCloseTo(cursor.x, 6);
  expect(stillThere.y).toBeCloseTo(cursor.y, 6);
});

it("clamps zoom to the allowed range", () => {
  expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 1000).zoom).toBe(30);
  expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 0.0001).zoom).toBe(0.1);
});

it("expands bounds for a rotated rectangle", () => {
  const el = { ...createElement("rectangle", { x: 0, y: 0, width: 100, height: 50 }, "V"), angle: Math.PI / 4 };
  const b = elementBounds(el);
  expect(b.width).toBeCloseTo(106.066, 2);
  expect(b.height).toBeCloseTo(106.066, 2);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @penpaper/engine test`
Expected: FAIL — cannot resolve `./camera`.

- [ ] **Step 3: Implement**

`screenToScene = { x: (p.x - camera.x) / zoom, y: (p.y - camera.y) / zoom }`, its exact inverse for `sceneToScreen`. `zoomAt` computes the scene point under the cursor, applies the clamped factor, then solves for the camera offset that restores it. `elementBounds` rotates the four corners about the element centre and takes the axis-aligned hull.

- [ ] **Step 4: Run and confirm pass** — `pnpm --filter @penpaper/engine test`, 4 new tests pass.

- [ ] **Step 5: Commit** — `git commit -m "feat(engine): camera transforms and rotated bounds"`

---

### Task 4: Quadtree and hit testing

**Files:**
- Create: `packages/engine/src/math/quadtree.ts`, `packages/engine/src/math/quadtree.test.ts`
- Create: `packages/engine/src/math/hit-test.ts`, `packages/engine/src/math/hit-test.test.ts`

**Interfaces:**
- Produces: `class Quadtree { constructor(bounds: Bounds, maxItems?: number, maxDepth?: number); insert(id: string, b: Bounds): void; query(area: Bounds): string[]; clear(): void }`; `hitTest(scene: Scene, tree: Quadtree, point: Point, tolerance?: number): string | null` — returns the topmost element under the point (highest `index` wins).

- [ ] **Step 1: Write the failing tests**

```ts
it("returns only ids whose bounds intersect the query area", () => {
  const tree = new Quadtree({ x: 0, y: 0, width: 1000, height: 1000 });
  tree.insert("a", { x: 0, y: 0, width: 10, height: 10 });
  tree.insert("b", { x: 500, y: 500, width: 10, height: 10 });
  expect(tree.query({ x: 0, y: 0, width: 50, height: 50 })).toEqual(["a"]);
});

it("hit-tests the topmost element first", () => {
  const scene = new Scene();
  scene.add({ ...createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "T"), id: "bottom" });
  scene.add({ ...createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "U"), id: "top" });
  const tree = new Quadtree({ x: 0, y: 0, width: 200, height: 200 });
  for (const el of scene.ordered()) tree.insert(el.id, elementBounds(el));
  expect(hitTest(scene, tree, { x: 50, y: 50 })).toBe("top");
});
```

- [ ] **Step 2: Run and confirm failure** — `pnpm --filter @penpaper/engine test` → FAIL.

- [ ] **Step 3: Implement**

Quadtree subdivides into four children when a node exceeds `maxItems` at depth < `maxDepth`; `query` walks only intersecting quadrants. `hitTest` queries the tree with a `tolerance`-expanded point box, sorts candidates by `index` descending, and returns the first whose exact shape test passes (rectangle/ellipse/diamond analytic; line/arrow distance-to-segment; freedraw bounding box).

- [ ] **Step 4: Run and confirm pass** — 2 new tests pass.

- [ ] **Step 5: Commit** — `git commit -m "feat(engine): quadtree and hit testing"`

---

### Task 5: Canvas surface with DPR and resize

**Files:**
- Create: `packages/engine/src/render/surface.ts`, `packages/engine/src/render/surface.test.ts`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/page.tsx`
- Create: `apps/web/components/BoardSurface.tsx`, `apps/web/next.config.ts`, `apps/web/app/manifest.ts`

**Interfaces:**
- Produces: `computeBackingSize(cssW: number, cssH: number, dpr: number, maxDpr?: number): { width: number; height: number; dpr: number }`; React component `<BoardSurface onReady={(ctx, size) => void} />` that fills its parent and re-sizes on `ResizeObserver`.

- [ ] **Step 1: Write the failing test**

```ts
it("caps the device pixel ratio", () => {
  expect(computeBackingSize(390, 844, 3, 2)).toEqual({ width: 780, height: 1688, dpr: 2 });
  expect(computeBackingSize(390, 844, 3, 1.5)).toEqual({ width: 585, height: 1266, dpr: 1.5 });
});
```

- [ ] **Step 2: Run and confirm failure** — `pnpm --filter @penpaper/engine test` → FAIL.

- [ ] **Step 3: Implement**

`computeBackingSize` rounds to integers and clamps `dpr` to `maxDpr`. `BoardSurface` renders a `<canvas>` with `className="absolute inset-0 h-full w-full touch-none"`, sizes its backing store through the helper on mount and on `ResizeObserver` changes, and calls `onReady` with the 2D context. `layout.tsx` sets `<html lang="en">`, viewport `viewportFit: "cover"`, `themeColor` for light/dark, and a `body` of `h-[100dvh] overflow-hidden overscroll-none`.

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm --filter @penpaper/engine test && pnpm --filter web build`
Expected: tests pass; build succeeds.

- [ ] **Step 5: Commit** — `git commit -m "feat: canvas surface with DPR cap and responsive shell"`

---

### Task 6: Renderer, static layer, grid, and culling

**Files:**
- Create: `packages/engine/src/render/static-layer.ts`, `packages/engine/src/render/static-layer.test.ts`
- Create: `packages/engine/src/render/renderer.ts`, `packages/engine/src/render/renderer.test.ts`
- Create: `packages/engine/src/render/theme.ts`

**Interfaces:**
- Produces: `interface StaticLayer { resize(w, h, dpr): void; clear(): void; draw(paint: (ctx: CanvasRenderingContext2D) => void): void; blitTo(target: CanvasRenderingContext2D, w: number, h: number): void }`; `createStaticLayer(): StaticLayer`; `class Renderer { constructor(ctx, scene: Scene, camera: Camera, options: RendererOptions); markDirty(): void; setCamera(c: Camera): void; render(): RenderStats; get stats(): RenderStats }`; `RenderStats { drawn: number; culled: number; frameMs: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("culls elements outside the viewport", () => {
  const scene = new Scene();
  scene.add({ ...createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, "V"), id: "visible" });
  scene.add({ ...createElement("rectangle", { x: 50_000, y: 50_000, width: 10, height: 10 }, "W"), id: "far" });
  const renderer = new Renderer(fakeCtx(), scene, { x: 0, y: 0, zoom: 1 }, { width: 800, height: 600 });
  renderer.markDirty();
  expect(renderer.render()).toMatchObject({ drawn: 1, culled: 1 });
});

it("does not redraw when nothing is dirty", () => {
  const renderer = new Renderer(fakeCtx(), new Scene(), { x: 0, y: 0, zoom: 1 }, { width: 800, height: 600 });
  renderer.render();
  const first = renderer.stats.frameMs;
  renderer.render();
  expect(renderer.stats.frameMs).toBe(first);
});
```

- [ ] **Step 2: Run and confirm failure** — FAIL on missing module.

- [ ] **Step 3: Implement**

`createStaticLayer` returns an `OffscreenCanvas`-backed layer when `OffscreenCanvas` exists, otherwise a detached `<canvas>` element; both satisfy the same interface. `Renderer.render()` early-returns when not dirty, paints background + optional grid (20px scene units, 1px, `--grid` colour), blits the static layer, then draws elements intersecting the expanded viewport, measuring `performance.now()` around the frame. Theme colours come from `theme.ts` (`light`/`dark` objects), never from CSS lookups inside the loop.

- [ ] **Step 4: Run and confirm pass** — 2 new tests pass.

- [ ] **Step 5: Commit** — `git commit -m "feat(engine): layered renderer with culling and dirty-frame skipping"`

---

### Task 7: Shape drawing with rough.js cache

**Files:**
- Create: `packages/engine/src/render/rough-cache.ts`, `packages/engine/src/render/rough-cache.test.ts`
- Create: `packages/engine/src/render/shapes/index.ts`, `rectangle.ts`, `ellipse.ts`, `diamond.ts`, `line.ts`, `arrow.ts`, `freedraw.ts`, `text.ts`
- Create: `packages/engine/src/render/shapes/shapes.test.ts`

**Interfaces:**
- Produces: `drawElement(ctx: CanvasRenderingContext2D, el: Element, cache: RoughCache, theme: Theme): void`; `class RoughCache { get(el: Element): Drawable; hitRate: number; clear(): void }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("reuses the drawable when geometry and style are unchanged", () => {
  const cache = new RoughCache();
  const el = createElement("rectangle", { x: 0, y: 0, width: 80, height: 40 }, "V");
  const first = cache.get(el);
  expect(cache.get({ ...el, x: 999 })).toBe(first);      // position is a transform, not a redraw
  expect(cache.get({ ...el, backgroundColor: "#f00" })).not.toBe(first);
});

it("draws every shape type without throwing", () => {
  for (const type of ["rectangle", "ellipse", "diamond", "line", "arrow", "freedraw", "text"] as const) {
    expect(() => drawElement(fakeCtx(), createElement(type, { x: 0, y: 0, width: 50, height: 50 }, "V"), new RoughCache(), lightTheme)).not.toThrow();
  }
});
```

- [ ] **Step 2: Run and confirm failure** — FAIL.

- [ ] **Step 3: Implement**

Key the cache by `${type}:${width}:${height}:${seed}:${roughness}:${fillStyle}:${strokeStyle}:${backgroundColor}:${strokeWidth}` — deliberately excluding `x`, `y`, and `angle`, which are applied with `ctx.translate`/`ctx.rotate`. `freedraw.ts` calls `getStroke(points, { size: strokeWidth * 2, simulatePressure })` and fills the resulting polygon. `text.ts` measures with the element's font and wraps to `width`. `arrow.ts` draws the shaft plus arrowhead paths sized by `strokeWidth`.

- [ ] **Step 4: Run and confirm pass** — 2 new tests pass.

- [ ] **Step 5: Commit** — `git commit -m "feat(engine): sketchy shape rendering with drawable cache"`

---

### Task 8: Input FSM, tools, and drag-to-create

**Files:**
- Create: `packages/engine/src/input/pointer.ts`, `packages/engine/src/input/fsm.ts`, `packages/engine/src/input/fsm.test.ts`
- Create: `packages/engine/src/input/tools.ts`, `packages/engine/src/input/controller.ts`, `packages/engine/src/input/controller.test.ts`
- Modify: `apps/web/components/BoardSurface.tsx` (attach pointer listeners)

**Interfaces:**
- Produces: `interface PointerInput { id: number; type: "mouse" | "pen" | "touch"; x: number; y: number; pressure: number; shift: boolean; alt: boolean; ctrl: boolean }`; `type Tool = "select" | "hand" | "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "freedraw" | "text" | "eraser"`; `type InteractionState = "idle" | "panning" | "selecting" | "dragging" | "resizing" | "rotating" | "drawing" | "editingText" | "erasing"`; `class InteractionFSM { constructor(initial: InteractionState); transition(next: InteractionState): void; get state(): InteractionState }`; `class InputController { constructor(deps: ControllerDeps); setTool(t: Tool): void; pointerDown(e: PointerInput): void; pointerMove(e: PointerInput): void; pointerUp(e: PointerInput): void; get state(): InteractionState }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("rejects illegal transitions", () => {
  const fsm = new InteractionFSM("idle");
  expect(() => fsm.transition("rotating")).toThrow(/illegal transition/i);
  fsm.transition("drawing");
  expect(fsm.state).toBe("drawing");
});

it("creates a rectangle spanning the drag", () => {
  const deps = makeDeps();
  const c = new InputController(deps);
  c.setTool("rectangle");
  c.pointerDown({ ...basePointer, x: 100, y: 100 });
  c.pointerMove({ ...basePointer, x: 180, y: 160 });
  c.pointerUp({ ...basePointer, x: 180, y: 160 });
  const [el] = deps.scene.ordered();
  expect(el).toMatchObject({ type: "rectangle", x: 100, y: 100, width: 80, height: 60 });
});
```

- [ ] **Step 2: Run and confirm failure** — FAIL.

- [ ] **Step 3: Implement**

`InteractionFSM` holds an explicit transition table (`idle → select`, `select → dragging|panning|selecting|idle`, `drawing → idle`, …) and throws on illegal edges in development. `InputController` reads camera-relative scene coordinates, routes to the active tool handler, and emits `onSceneChange()` on commit. Drags shorter than 4px on a shape tool create a default-sized element (100×100) rather than a zero-height one.

- [ ] **Step 4: Run and confirm pass** — 2 new tests pass.

- [ ] **Step 5: Commit** — `git commit -m "feat(engine): input state machine and drag-to-create tools"`

---

### Task 9: Gestures — pan, zoom, pinch, palm rejection

**Files:**
- Create: `packages/engine/src/input/gestures.ts`, `packages/engine/src/input/gestures.test.ts`
- Create: `packages/engine/src/input/palm.ts`, `packages/engine/src/input/palm.test.ts`
- Modify: `packages/engine/src/input/controller.ts` (delegate multi-pointer input)
- Create: `apps/web/e2e/gestures.spec.ts`

**Interfaces:**
- Produces: `class PalmRejection { notePen(time: number): void; accept(input: { type: string; time: number }): boolean }`; `class GestureArbiter { pointerDown(e: PointerInput, time: number): "single" | "multi"; pointerUp(e): void; reset(): void; get active(): number }`; `panBy(camera: Camera, dx: number, dy: number): Camera`.

- [ ] **Step 1: Write the failing tests**

```ts
it("ignores touch while a pen is active", () => {
  const palm = new PalmRejection(800);
  palm.notePen(1000);
  expect(palm.accept({ type: "touch", time: 1500 })).toBe(false);
  expect(palm.accept({ type: "touch", time: 1850 })).toBe(true);
  expect(palm.accept({ type: "pen", time: 1400 })).toBe(true);
});

it("cancels the in-progress stroke when a second finger lands", () => {
  const arbiter = new GestureArbiter();
  expect(arbiter.pointerDown(p1, 0)).toBe("single");
  expect(arbiter.pointerDown(p2, 10)).toBe("multi");
});
```

```ts
// apps/web/e2e/gestures.spec.ts
test("pinch on the canvas does not zoom the page", async ({ page }) => {
  await page.goto("/b/local");
  const before = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  await page.locator("canvas").dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 1, clientX: 200, clientY: 300 });
  await page.locator("canvas").dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 2, clientX: 260, clientY: 300 });
  await page.locator("canvas").dispatchEvent("pointermove", { pointerType: "touch", pointerId: 1, clientX: 140, clientY: 300 });
  await page.locator("canvas").dispatchEvent("pointermove", { pointerType: "touch", pointerId: 2, clientX: 320, clientY: 300 });
  const after = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  expect(after).toBe(before);
});
```

- [ ] **Step 2: Run and confirm failure** — unit tests FAIL; e2e fails to find the canvas.

- [ ] **Step 3: Implement**

`PalmRejection` stores `activeUntil = time + window` and extends on every pen event. `GestureArbiter` tracks concurrent pointers; the second pointer triggers a `cancel-stroke` callback on the controller, then pan+zoom from the midpoint distance ratio. Wheel handling: `ctrl`/`meta` → `zoomAt`, `shift` → horizontal pan, otherwise vertical pan. Register listeners with `{ passive: false }` on the canvas only.

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm --filter @penpaper/engine test && pnpm --filter web e2e -- gestures`
Expected: all pass.

- [ ] **Step 5: Commit** — `git commit -m "feat(engine): gesture arbitration, pinch zoom, palm rejection"`

---

### Task 10: Selection, move, resize, rotate

**Files:**
- Create: `packages/engine/src/selection/handles.ts`, `packages/engine/src/selection/handles.test.ts`
- Create: `packages/engine/src/selection/transform.ts`, `packages/engine/src/selection/transform.test.ts`
- Create: `packages/engine/src/render/selection-overlay.ts`
- Modify: `packages/engine/src/input/controller.ts`

**Interfaces:**
- Produces: `type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotation"`; `getHandles(el: Element, camera: Camera, hitSize: number): Array<{ handle: Handle; point: Point }>`; `resizeElement(el: Element, handle: Handle, pointer: Point, opts: { keepAspect: boolean; fromCenter: boolean }): Partial<Element>`; `rotateElement(el: Element, pointer: Point, opts: { snap: boolean }): Partial<Element>`.

- [ ] **Step 1: Write the failing tests**

```ts
it("snaps rotation to 15 degree steps when requested", () => {
  const el = { ...createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, "V"), angle: 0 };
  const patch = rotateElement(el, { x: 100, y: 14 }, { snap: true });
  expect(patch.angle).toBeCloseTo(0, 6);
});

it("keeps the aspect ratio when the corner handle is dragged with shift", () => {
  const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 50 }, "V");
  const patch = resizeElement(el, "se", { x: 200, y: 200 }, { keepAspect: true, fromCenter: false });
  expect(patch.width! / patch.height!).toBeCloseTo(2, 2);
});

it("never produces a negative width", () => {
  const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 50 }, "V");
  const patch = resizeElement(el, "se", { x: -200, y: -200 }, { keepAspect: false, fromCenter: false });
  expect(patch.width!).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run and confirm failure** — FAIL.

- [ ] **Step 3: Implement**

Handles are computed in screen space so they stay 8px regardless of zoom, but hit-tested with a 44px touch radius when `pointerType !== "mouse"`. Resize flips the anchor when the pointer crosses the opposite edge. Rotation uses `atan2` from the element centre, normalised to `[0, 2π)`, snapped to `π/12` when shift is held. The overlay draws a 1px blue box, 8px corner handles, and a rotate handle 20px above the top edge.

- [ ] **Step 4: Run and confirm pass** — 3 new tests pass.

- [ ] **Step 5: Commit** — `git commit -m "feat(engine): selection handles, resize and rotation math"`

---

### Task 11: Toolbar and properties panel (responsive)

**Files:**
- Create: `packages/ui/src/toolbar.tsx`, `packages/ui/src/properties-panel.tsx`, `packages/ui/src/bottom-sheet.tsx`
- Create: `apps/web/components/BoardChrome.tsx`
- Create: `apps/web/e2e/layout.spec.ts`
- Modify: `apps/web/app/globals.css` (design tokens)

**Interfaces:**
- Produces: `<Toolbar value={Tool} onChange={(t: Tool) => void} />`; `<PropertiesPanel selection={Element[]} onPatch={(patch: Partial<Element>) => void} />`; `<BottomSheet snapPoints={["peek", "half", "full"]} children />`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/e2e/layout.spec.ts
test.describe("responsive chrome", () => {
  test("dock is horizontal at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/b/local");
    const rect = await page.getByTestId("tool-dock").boundingBox();
    expect(rect!.width).toBeGreaterThan(rect!.height);
  });

  test("dock is vertical at 1440px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/b/local");
    const rect = await page.getByTestId("tool-dock").boundingBox();
    expect(rect!.height).toBeGreaterThan(rect!.width);
  });

  test.describe("coarse pointer", () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    test("every dock button is at least 44px", async ({ page }) => {
      await page.goto("/b/local");
      const boxes = await page
        .getByTestId("tool-button")
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
      for (const box of boxes) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });
  });
});
```

- [ ] **Step 2: Run and confirm failure** — FAIL, no `tool-dock`.

- [ ] **Step 3: Implement**

Tailwind container queries are unnecessary here: use `md:` (768) and `lg:` (1024) exactly. Dock is `flex-col` at `lg` and `flex-row overflow-x-auto` below. Properties render as a right sidebar at `lg`, otherwise inside `BottomSheet`. Bottom sheet uses pointer-drag with a 72px peek, `transform: translateY`, and `transition` disabled under `prefers-reduced-motion`. Tokens live as CSS variables in `globals.css` (`--background`, `--foreground`, `--grid`, `--accent`, `--ring`) with a `.dark` override.

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm --filter web e2e -- layout`
Expected: 3 tests pass at all three viewports.

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): responsive toolbar and properties sheet"`

---

### Task 12: History with drag coalescing

**Files:**
- Create: `packages/engine/src/history/history.ts`, `packages/engine/src/history/history.test.ts`
- Create: `packages/engine/src/history/commands.ts`
- Modify: `packages/engine/src/input/controller.ts` (emit transactions)

**Interfaces:**
- Produces: `interface Command { apply(scene: Scene): void; revert(scene: Scene): void; label: string }`; `class History { constructor(scene: Scene, limit?: number); push(cmd: Command): void; begin(label: string): void; commit(): void; undo(): boolean; redo(): boolean; canUndo(): boolean; canRedo(): boolean }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("collapses a whole drag into one undo step", () => {
  const scene = new Scene();
  const el = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, "V");
  scene.add(el);
  const history = new History(scene);
  history.begin("move");
  for (let i = 0; i < 50; i++) scene.update(el.id, { x: i });
  history.commit();
  expect(history.canUndo()).toBe(true);
  history.undo();
  expect(scene.get(el.id)!.x).toBe(0);
  expect(history.canUndo()).toBe(false);
});

it("clears the redo stack after a new command", () => {
  const history = new History(new Scene());
  history.push(addCommand("a"));
  history.undo();
  expect(history.canRedo()).toBe(true);
  history.push(addCommand("b"));
  expect(history.canRedo()).toBe(false);
});
```

- [ ] **Step 2: Run and confirm failure** — FAIL.

- [ ] **Step 3: Implement**

Transactions capture a shallow snapshot of affected elements on `begin` and diff on `commit`; an empty diff is discarded. `undo()` reverts the last command and pushes it to the redo stack; `push` clears redo. History caps at 100 commands, dropping the oldest.

- [ ] **Step 4: Run and confirm pass** — 2 new tests pass.

- [ ] **Step 5: Commit** — `git commit -m "feat(engine): transactional undo history"`

---

### Task 13: Board store, IndexedDB autosave, hydration

**Files:**
- Create: `packages/engine/src/serialize.ts`, `packages/engine/src/serialize.test.ts`
- Create: `apps/web/lib/storage.ts`, `apps/web/lib/storage.test.ts`
- Create: `apps/web/store/board-store.ts`
- Create: `apps/web/app/b/[id]/page.tsx`
- Create: `apps/web/e2e/persistence.spec.ts`

**Interfaces:**
- Produces: `serializeScene(scene: Scene): string`; `deserializeScene(json: string): Scene`; `saveBoard(id: string, snapshot: BoardSnapshot): Promise<void>`; `loadBoard(id: string): Promise<BoardSnapshot | null>`; `useBoardStore` with `{ elements, tool, camera, selection, setTool, setCamera, patchElements, replaceAll }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("round-trips a scene through JSON", () => {
  const scene = new Scene();
  scene.add(createElement("freedraw", { x: 0, y: 0, width: 10, height: 10 }, "V"));
  const restored = deserializeScene(serializeScene(scene));
  expect(restored.ordered()).toEqual(scene.ordered());
});

// apps/web/e2e/persistence.spec.ts
test("a drawn shape survives a reload", async ({ page }) => {
  await page.goto("/b/e2e-board");
  await page.getByTestId("tool-rectangle").click();
  await page.locator("canvas").dragTo(page.locator("canvas"), { targetPosition: { x: 300, y: 260 }, sourcePosition: { x: 120, y: 160 } });
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByTestId("element-count")).toHaveText("1");
});
```

- [ ] **Step 2: Run and confirm failure** — FAIL.

- [ ] **Step 3: Implement**

`/b/[id]` is a client component that loads the snapshot from IndexedDB on mount (showing a skeleton, never a blank flash), hydrates the store, and subscribes to changes with a 500ms debounce. Flush on `visibilitychange === "hidden"` and on `pagehide`. `serializeScene` writes `{ version: 1, elements: ordered() }`. `saveBoard` uses `idb`'s `set` on a `boards` store.

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm --filter @penpaper/engine test && pnpm --filter web e2e -- persistence`
Expected: all pass.

- [ ] **Step 5: Commit** — `git commit -m "feat(web): local-first board store with IndexedDB autosave"`

---

### Task 14: Text editing overlay

**Files:**
- Create: `apps/web/components/TextEditorOverlay.tsx`
- Create: `packages/engine/src/text/measure.ts`, `packages/engine/src/text/measure.test.ts`
- Create: `apps/web/e2e/text.spec.ts`

**Interfaces:**
- Produces: `<TextEditorOverlay element={Element} camera={Camera} onCommit={(text: string) => void} onCancel={() => void} />`; `wrapText(text: string, maxWidth: number, font: string, measure: (s: string, font: string) => number): string[]`.

- [ ] **Step 1: Write the failing tests**

```ts
it("wraps on word boundaries without exceeding the width", () => {
  const measure = (s: string) => s.length * 10;
  expect(wrapText("hello world again", 110, "16px sans", measure)).toEqual(["hello", "world", "again"]);
});

// apps/web/e2e/text.spec.ts
test("the hidden textarea is at least 16px to stop iOS zoom", async ({ page }) => {
  await page.goto("/b/local");
  await page.getByTestId("tool-text").click();
  await page.locator("canvas").click({ position: { x: 200, y: 200 } });
  const size = await page.getByTestId("text-overlay").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});
```

- [ ] **Step 2: Run and confirm failure** — FAIL.

- [ ] **Step 3: Implement**

The overlay is an absolutely positioned `<textarea>` sized to the element, transparent background, `font-size: max(16px, ${fontSize * zoom}px)`, matching the element's font. `compositionstart`/`compositionend` toggle a `composing` flag so IME text is not committed mid-composition. Escape commits, blur commits, and the element is removed if it is left empty. `visualViewport` scroll ensures the element sits in the top third when the keyboard is open.

- [ ] **Step 4: Run and confirm pass** — both tests pass.

- [ ] **Step 5: Commit** — `git commit -m "feat: canvas text editing overlay with IME and iOS-safe sizing"`

---

### Task 15: PWA shell, deploy, and performance gate

**Files:**
- Create: `public/sw.js`, `public/icons/icon-192.png`, `public/icons/icon-512.png`
- Create: `apps/web/components/ServiceWorkerRegistrar.tsx`
- Create: `apps/web/e2e/perf.spec.ts`, `apps/web/scripts/check-bundle-size.mjs`
- Create: `README.md`, `docs/ARCHITECTURE.md`
- Modify: `.github/workflows/ci.yml` (bundle check)

**Interfaces:**
- Produces: installable PWA; `pnpm --filter web check:bundle` enforcing the 220 KB board-route budget; a live Vercel deployment.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/e2e/perf.spec.ts
test("1,000 elements render within the frame budget", async ({ page }) => {
  await page.goto("/b/perf");
  await page.evaluate(() => window.__seedPerfBoard?.(1000));
  await page.waitForTimeout(500);
  const median = await page.evaluate(() => window.__perf?.medianFrameMs ?? 999);
  expect(median).toBeLessThanOrEqual(16);
});
```

```js
// apps/web/scripts/check-bundle-size.mjs — exits 1 when the board chunk exceeds 220 KB gz
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter web e2e -- perf && pnpm --filter web check:bundle`
Expected: FAIL — `__seedPerfBoard` undefined; chunk exceeds budget or script missing.

- [ ] **Step 3: Implement**

Service worker precaches `"/"`, `"/b/offline"`, the JS/CSS build manifest, and the Excalifont woff2; it uses network-first for navigation and cache-first for hashed assets. `__seedPerfBoard(count)` is a dev-only hook that fills the scene with rectangles for the perf test. `check:bundle` parses `.next/app-build-manifest.json`, sums gzipped sizes for the `/b/[id]` route, and fails above 220,000 bytes. README documents the live URL, the demo board, the architecture diagram, and the measured numbers.

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm --filter web e2e -- perf && pnpm --filter web check:bundle`
Expected: PASS; median frame time ≤ 16ms at 1,000 elements; bundle ≤ 220 KB gz.

- [ ] **Step 5: Deploy and commit**

Deploy `apps/web` to Vercel, attach the domain, confirm the production URL loads `/b/demo` on a phone. Then:

```bash
git add . && git commit -m "feat: PWA shell, deploy, and performance budget gate"
```

---

## Subsequent plans

Phase 1 ends here — a deployed, installable, multi-device whiteboard that persists locally. The remaining work is planned separately, because each produces working software on its own and depends on Phase 1's interfaces:

- **Phase 2 — Product shell:** auth, Postgres boards, REST persistence, share links, dashboard, export, thumbnails.
- **Phase 3 — Multiplayer:** Node + Socket.IO collab service, Yjs sync handshake, presence, reconnect, offline merge. Host: **Render free** (512 MB, WebSockets supported, no card) kept warm by an 08:00–24:00 IST uptime ping; the service reads `PORT` and `DATABASE_URL` from the environment, so any container host is a config change.
- **Phase 4 — Polish and launch:** arrow binding (a resume claim — cannot be cut), snapping, grouping, images, command palette, templates, observability.

Plan Phase 2 only after Phase 1's engine interfaces are real; writing it earlier would guess at names that the build will settle.
