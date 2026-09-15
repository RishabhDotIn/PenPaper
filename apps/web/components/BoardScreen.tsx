"use client";

import { BoardChrome } from "@/components/BoardChrome";
import { BoardSurface, type SurfaceSize } from "@/components/BoardSurface";
import {
  InputController,
  Quadtree,
  Renderer,
  Scene,
  TOOL_SHORTCUTS,
  darkTheme,
  elementBounds,
  hitTest,
  lightTheme,
  type PointerInput,
  type Tool,
  type WheelInput,
} from "@penpaper/engine";
import type { Element } from "@penpaper/shared";
import { useCallback, useEffect, useRef, useState } from "react";

const WORLD = { x: -1_000_000, y: -1_000_000, width: 2_000_000, height: 2_000_000 };

export interface BoardScreenProps {
  boardId: string;
}

/**
 * The whole seam between React and the engine.
 *
 * React owns one canvas element, the tool, and a copy of the selection. The
 * engine owns the scene, the camera, and every element. No element data lives
 * in React state, so a board with thousands of shapes does not produce
 * thousands of re-renders while drawing.
 */
export function BoardScreen({ boardId }: BoardScreenProps) {
  const sceneRef = useRef<Scene | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const controllerRef = useRef<InputController | null>(null);
  const treeRef = useRef<Quadtree | null>(null);
  const frameRef = useRef(0);

  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<Element[]>([]);
  const [ready, setReady] = useState(false);
  const toolRef = useRef<Tool>("select");

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

  /**
   * The controller owns selection state; the renderer only knows how to paint
   * it. Pushing it across explicitly keeps that ownership one-directional.
   */
  const syncOverlays = useCallback(() => {
    const controller = controllerRef.current;
    const renderer = rendererRef.current;
    if (!controller || !renderer) return;
    renderer.setSelection(controller.selectedElements);
    renderer.setMarquee(controller.marquee);
  }, []);

  const refreshSelection = useCallback(() => {
    setSelection(controllerRef.current?.selectedElements ?? []);
    syncOverlays();
    scheduleRender();
  }, [scheduleRender, syncOverlays]);

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
        onRender: () => {
          syncOverlays();
          scheduleRender();
        },
        onSceneChange: () => {
          reindex();
          scheduleRender();
        },
        onSelectionChange: refreshSelection,
      });

      controller.setTool(toolRef.current);
      controllerRef.current = controller;

      reindex();
      scheduleRender();
      setReady(true);
    },
    [reindex, refreshSelection, scheduleRender, syncOverlays],
  );

  const changeTool = useCallback((next: Tool) => {
    toolRef.current = next;
    setTool(next);
    controllerRef.current?.setTool(next);
  }, []);

  const patchSelection = useCallback((patch: Partial<Element>) => {
    controllerRef.current?.patchSelection(patch);
  }, []);

  const deleteSelection = useCallback(() => {
    controllerRef.current?.deleteSelection();
  }, []);

  // A phone opens with the pen: "select" on a blank board is a dead tap.
  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) changeTool("freedraw");
  }, [changeTool]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => rendererRef.current?.setTheme(media.matches ? darkTheme : lightTheme);

    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();
      const nextTool = TOOL_SHORTCUTS[key];
      if (nextTool) {
        event.preventDefault();
        changeTool(nextTool);
        return;
      }

      if (key === "delete" || key === "backspace") {
        // Backspace would otherwise navigate back a page.
        event.preventDefault();
        deleteSelection();
        return;
      }

      if (key === "escape") controllerRef.current?.setSelection([]);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [changeTool, deleteSelection]);

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
    <main
      className="relative h-[100dvh] w-full overflow-hidden"
      data-board-id={boardId}
      data-ready={ready}
      style={{ background: "var(--surface-lowest)" }}
    >
      <BoardSurface
        onReady={handleReady}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
      />

      <BoardChrome
        tool={tool}
        onToolChange={changeTool}
        selection={selection}
        onPatch={patchSelection}
        onDelete={deleteSelection}
      />
    </main>
  );
}
