"use client";

import { BoardChrome } from "@/components/BoardChrome";
import { BoardSurface, type SurfaceSize } from "@/components/BoardSurface";
import { TextEditorOverlay } from "@/components/TextEditorOverlay";
import { saveBoard, type BoardSnapshot } from "@/lib/storage";
import { useBoardStore } from "@/store/board-store";
import {
  History,
  InputController,
  Quadtree,
  Renderer,
  Scene,
  TOOL_SHORTCUTS,
  createElement,
  darkTheme,
  elementBounds,
  hitTest,
  lightTheme,
  screenToScene,
  type Camera,
  type PointerInput,
  type Tool,
  type WheelInput,
} from "@penpaper/engine";
import type { Element } from "@penpaper/shared";
import { useCallback, useEffect, useRef, useState } from "react";

const WORLD = { x: -1_000_000, y: -1_000_000, width: 2_000_000, height: 2_000_000 };
const IDENTITY_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/** Long enough to coalesce a stroke, short enough to survive a tab crash. */
const SAVE_DEBOUNCE_MS = 500;

export interface BoardInitialState {
  elements: Element[];
  camera: Camera;
}

export interface BoardScreenProps {
  boardId: string;
  /** Hydrated from IndexedDB before this component mounts. */
  initial?: BoardInitialState | null;
}

/**
 * The whole seam between React and the engine.
 *
 * React owns one canvas element, the tool, and a copy of the selection. The
 * engine owns the scene, the camera, and every element. No element data lives
 * in React state, so a board with thousands of shapes does not produce
 * thousands of re-renders while drawing.
 */
export function BoardScreen({ boardId, initial }: BoardScreenProps) {
  const sceneRef = useRef<Scene | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const controllerRef = useRef<InputController | null>(null);
  const historyRef = useRef<History | null>(null);
  const treeRef = useRef<Quadtree | null>(null);
  const frameRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<Element[]>([]);
  const [elementCount, setElementCount] = useState(initial?.elements.length ?? 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
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

  const refreshStats = useCallback(() => {
    const count = sceneRef.current?.size ?? 0;
    setElementCount(count);
    useBoardStore.getState().setElementCount(count);
  }, []);

  const writeSnapshot = useCallback(async () => {
    const scene = sceneRef.current;
    const controller = controllerRef.current;
    if (!scene || !controller) return;

    const snapshot: BoardSnapshot = {
      version: 1,
      elements: scene.ordered(),
      camera: controller.getCamera(),
      savedAt: Date.now(),
    };

    try {
      await saveBoard(boardId, snapshot);
      useBoardStore.getState().markSaved(snapshot.savedAt);
    } catch (error) {
      // A board that cannot be written must still be usable. The next edit or
      // an explicit flush retries; the visible chrome reports the problem.
      dirtyRef.current = true;
      useBoardStore.getState().setStatus("unavailable");
      console.warn("PenPaper: could not save board locally", error);
    }
  }, [boardId]);

  /**
   * Debounced write: pointer-up and camera settles are the moments that matter,
   * and IndexedDB writes on every frame would compete with rendering.
   */
  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      void writeSnapshot();
    }, SAVE_DEBOUNCE_MS);
  }, [writeSnapshot]);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    void writeSnapshot();
  }, [writeSnapshot]);

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

  /** Mirrors the history stacks into React so the chrome can disable buttons. */
  const refreshHistory = useCallback(() => {
    const history = historyRef.current;
    setCanUndo(history?.canUndo() ?? false);
    setCanRedo(history?.canRedo() ?? false);
  }, []);

  const handleReady = useCallback(
    (ctx: CanvasRenderingContext2D, size: SurfaceSize) => {
      const isFirstReady = sceneRef.current === null;
      const scene = sceneRef.current ?? new Scene();

      // Hydration happens exactly once: `onReady` also fires on resize, and
      // re-adding the saved elements would duplicate or clobber edits.
      if (isFirstReady && initial) {
        for (const element of initial.elements) {
          if (!scene.get(element.id)) scene.add(element);
        }
      }
      sceneRef.current = scene;

      const history = historyRef.current ?? new History(scene);
      historyRef.current = history;

      const tree = treeRef.current ?? new Quadtree(WORLD);
      treeRef.current = tree;

      const existing = rendererRef.current;
      if (existing) {
        existing.setSize(size.width, size.height, size.dpr);
        scheduleRender();
        return;
      }

      const camera = initial?.camera ?? IDENTITY_CAMERA;
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const renderer = new Renderer(ctx, scene, camera, {
        width: size.width,
        height: size.height,
        dpr: size.dpr,
        theme: prefersDark ? darkTheme : lightTheme,
      });
      rendererRef.current = renderer;

      const controller = new InputController({
        scene,
        camera,
        history,
        hitTest: (point, tolerance) => hitTest(scene, tree, point, tolerance),
        onCameraChange: (next) => {
          renderer.setCamera(next);
          scheduleSave();
        },
        onRender: () => {
          syncOverlays();
          scheduleRender();
        },
        onSceneChange: () => {
          reindex();
          refreshStats();
          refreshHistory();
          scheduleSave();
          scheduleRender();
        },
        onSelectionChange: refreshSelection,
        onCreateText: (element) => setEditingId(element.id),
      });

      controller.setTool(toolRef.current);
      controllerRef.current = controller;

      reindex();
      refreshStats();
      refreshHistory();
      scheduleRender();
      setReady(true);
    },
    [initial, reindex, refreshHistory, refreshSelection, refreshStats, scheduleRender, scheduleSave, syncOverlays],
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

  /**
   * Undo can tombstone or resurrect elements, so the spatial index, the
   * element count, and the selection all have to be recomputed. The selection
   * is pruned through the controller so the panel never edits a deleted element.
   */
  const afterHistory = useCallback(() => {
    reindex();
    const controller = controllerRef.current;
    if (controller) {
      controller.setSelection(controller.selectedElements.map((element) => element.id));
    }
    refreshStats();
    refreshHistory();
    scheduleSave();
    scheduleRender();
  }, [reindex, refreshHistory, refreshStats, scheduleRender, scheduleSave]);

  const undo = useCallback(() => {
    if (historyRef.current?.undo()) afterHistory();
  }, [afterHistory]);

  const redo = useCallback(() => {
    if (historyRef.current?.redo()) afterHistory();
  }, [afterHistory]);

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

  // A hidden tab may be closed without another chance to write, and iOS often
  // kills backgrounded pages outright; flush while the document is still alive.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushSave();
    };

    window.addEventListener("pagehide", flushSave);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushSave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flushSave();
    };
  }, [flushSave]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }

      const key = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
        // Ctrl+Y is the Windows convention; the app supports both.
        if (key === "y") {
          event.preventDefault();
          redo();
          return;
        }
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

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
  }, [changeTool, deleteSelection, redo, undo]);

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

  /**
   * Dev-only seam for the performance gate.
   *
   * Production builds return before touching `window`, so the seeded board and
   * the timing shim cannot be reached from a real deployment. The measurement
   * is the renderer's own frame body (layout + cull + paint commands), not the
   * rAF interval: rAF is clamped to the display refresh rate and would report
   * ~16.7 ms even on a board that takes 200 ms to build.
   */
  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.NEXT_PUBLIC_E2E !== "1"
    ) {
      return;
    }
    if (!ready) return;

    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const controller = controllerRef.current;
    if (!scene || !renderer || !controller) return;

    const seeded: string[] = [];
    const perf = { medianFrameMs: Number.POSITIVE_INFINITY, seeded: 0 };
    window.__perf = perf;

    window.__seedPerfBoard = (count = 1000) => {
      for (const id of seeded) {
        if (scene.get(id)) scene.remove(id);
      }
      seeded.length = 0;

      const camera = controller.getCamera();
      const start = screenToScene(camera, { x: 24, y: 24 });
      const stepX = 32 / camera.zoom;
      const stepY = 28 / camera.zoom;
      const columns = 40;
      const palette = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#9c36b5"];
      const types = ["rectangle", "ellipse", "diamond"] as const;

      for (let index = 0; index < count; index += 1) {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const element = createElement(
          types[index % types.length]!,
          {
            x: start.x + column * stepX,
            y: start.y + row * stepY,
            width: 22 / camera.zoom,
            height: 18 / camera.zoom,
          },
          `seed-${String(index).padStart(6, "0")}`,
        );

        scene.add({
          ...element,
          strokeColor: palette[index % palette.length]!,
          roughness: index % 5 === 0 ? 2 : 1,
          angle: index % 13 === 0 ? 0.08 : 0,
          backgroundColor: index % 7 === 0 ? "#ffec99" : "transparent",
          fillStyle: index % 7 === 0 ? "hachure" : "solid",
        });
        seeded.push(element.id);
      }

      reindex();
      refreshStats();
      renderer.markDirty();
      renderer.render(); // warm the rough cache before timing

      const samples: number[] = [];
      for (let sample = 0; sample < 15; sample += 1) {
        renderer.markDirty();
        samples.push(renderer.render().frameMs);
      }

      samples.sort((a, b) => a - b);
      perf.medianFrameMs = samples[Math.floor(samples.length / 2)] ?? Number.POSITIVE_INFINITY;
      perf.seeded = seeded.length;
      return perf.medianFrameMs;
    };

    return () => {
      delete window.__seedPerfBoard;
      delete window.__perf;
    };
  }, [ready, refreshStats, reindex]);

  const editingElement = editingId ? sceneRef.current?.get(editingId) : undefined;

  const cursor =
    tool === "hand" ? "grab" : tool === "text" ? "text" : tool === "select" ? "default" : "crosshair";

  return (
    <main
      className="relative h-[100dvh] w-full overflow-hidden"
      data-board-id={boardId}
      data-ready={ready}
      data-elements={elementCount}
      style={{ background: "var(--surface-lowest)" }}
    >
      <BoardSurface
        cursor={cursor}
        onReady={handleReady}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
      />

      {editingElement ? (
        <TextEditorOverlay
          element={editingElement}
          camera={controllerRef.current?.getCamera() ?? IDENTITY_CAMERA}
          onCommit={(text) => {
            controllerRef.current?.setText(editingElement.id, text);
            setEditingId(null);
          }}
          onCancel={() => setEditingId(null)}
        />
      ) : null}

      <BoardChrome
        tool={tool}
        onToolChange={changeTool}
        selection={selection}
        onPatch={patchSelection}
        onDelete={deleteSelection}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
      />
    </main>
  );
}
