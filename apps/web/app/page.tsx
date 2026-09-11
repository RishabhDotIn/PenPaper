"use client";

import { BoardSurface, type SurfaceSize } from "@/components/BoardSurface";
import {
  InputController,
  Quadtree,
  Renderer,
  Scene,
  darkTheme,
  elementBounds,
  hitTest,
  lightTheme,
  type PointerInput,
  type WheelInput,
} from "@penpaper/engine";
import { useCallback, useRef } from "react";

const WORLD = { x: -1_000_000, y: -1_000_000, width: 2_000_000, height: 2_000_000 };

/**
 * The board route.
 *
 * This is the whole seam between React and the engine: React owns one canvas
 * element and a handful of callbacks, the engine owns everything else. No
 * element data lives in React state, so a 2 000-element board does not produce
 * 2 000 re-renders.
 */
export default function BoardPage() {
  const sceneRef = useRef<Scene | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const controllerRef = useRef<InputController | null>(null);
  const treeRef = useRef<Quadtree | null>(null);
  const frameRef = useRef(0);

  const scheduleRender = useCallback(() => {
    if (frameRef.current !== 0) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      rendererRef.current?.render();
    });
  }, []);

  const reindex = useCallback(() => {
    const scene = sceneRef.current;
    const tree = treeRef.current;
    if (!scene || !tree) return;
    tree.clear();
    for (const el of scene.ordered()) tree.insert(el.id, elementBounds(el));
  }, []);

  const handleReady = useCallback(
    (ctx: CanvasRenderingContext2D, size: SurfaceSize) => {
      const scene = sceneRef.current ?? new Scene();
      sceneRef.current = scene;

      const tree = treeRef.current ?? new Quadtree(WORLD);
      treeRef.current = tree;

      const existing = rendererRef.current;
      if (existing) {
        existing.setSize(size.width, size.height, size.dpr);
        scheduleRender();
        return;
      }

      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const renderer = new Renderer(ctx, scene, { x: 0, y: 0, zoom: 1 }, {
        width: size.width,
        height: size.height,
        theme: prefersDark ? darkTheme : lightTheme,
      });
      rendererRef.current = renderer;

      const controller = new InputController({
        scene,
        camera: { x: 0, y: 0, zoom: 1 },
        hitTest: (point, tolerance) => hitTest(scene, tree, point, tolerance),
        onCameraChange: (camera) => renderer.setCamera(camera),
        onRender: scheduleRender,
        onSceneChange: () => {
          reindex();
          scheduleRender();
        },
        onSelectionChange: scheduleRender,
      });

      // Nothing to select until the toolbar exists, so start the pen.
      controller.setTool("freedraw");
      controllerRef.current = controller;

      reindex();
      scheduleRender();
    },
    [reindex, scheduleRender],
  );

  const onPointerDown = useCallback((input: PointerInput) => {
    controllerRef.current?.pointerDown(input);
  }, []);

  const onPointerMove = useCallback((input: PointerInput) => {
    controllerRef.current?.pointerMove(input);
  }, []);

  const onPointerUp = useCallback((input: PointerInput) => {
    controllerRef.current?.pointerUp(input);
  }, []);

  const onPointerCancel = useCallback(() => {
    controllerRef.current?.pointerCancel();
  }, []);

  const onWheel = useCallback((input: WheelInput) => {
    controllerRef.current?.wheel(input);
  }, []);

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden">
      <BoardSurface
        onReady={handleReady}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
      />

      <header
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-center"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div
          className="pointer-events-auto rounded-[var(--radius-island)] px-3 py-2 text-sm font-medium"
          style={{ background: "var(--island-bg)", boxShadow: "var(--shadow-island)" }}
        >
          <span style={{ color: "var(--primary)" }}>Pen</span>
          <span>Paper</span>
        </div>
      </header>
    </main>
  );
}
