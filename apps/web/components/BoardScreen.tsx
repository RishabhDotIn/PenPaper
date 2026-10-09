"use client";

import { BoardChrome } from "@/components/BoardChrome";
import { BoardSurface, type SurfaceSize } from "@/components/BoardSurface";
import { PeerCursors } from "@/components/PeerCursors";
import { ShareDialog } from "@/components/ShareDialog";
import { TextEditorOverlay } from "@/components/TextEditorOverlay";
import {
  effectiveTheme,
  loadPreferences,
  rememberBoard,
  savePreferences,
  type Preferences,
} from "@/lib/preferences";
import { defaultTitle, loadMeta, saveBoard, type BoardSnapshot } from "@/lib/storage";
import { accountUser, useAccountStore } from "@/lib/collab/account";
import type { Role } from "@/lib/collab/api";
import {
  ensureServerBoard,
  flushServerSync,
  mergeServerElements,
  pullServerBoard,
  queueServerSync,
} from "@/lib/collab/board-sync";
import { guestId } from "@/lib/collab/identity";
import type { CollabPeer, CollabSession } from "@/lib/collab/session";
import {
  flushSyncQueue,
  queueBoardSync,
  reconcileBoard,
  syncLibraryInBackground,
} from "@/lib/drive/sync";
import { hasSession } from "@/lib/drive/auth";
import { useSyncStore } from "@/store/sync-store";
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

/** Tools that create a new element, and therefore have a style to choose. */
const CREATION_TOOLS: ReadonlySet<Tool> = new Set([
  "freedraw",
  "rectangle",
  "ellipse",
  "diamond",
  "triangle",
  "hexagon",
  "star",
  "arrow",
  "line",
  "text",
]);

/** Long enough to coalesce a stroke, short enough to survive a tab crash. */
const SAVE_DEBOUNCE_MS = 500;

/**
 * How often a moving stroke is offered to the room.
 *
 * The engine keeps the in-progress element in the scene, so a peer can watch it
 * grow. Sending the whole element ten times a second is cheap for a handful of
 * people and still feels live; every frame would be ink at 60 Hz with no gain.
 */
const COLLAB_PUSH_MS = 100;

export interface BoardInitialState {
  elements: Element[];
  camera: Camera;
}

export interface BoardScreenProps {
  boardId: string;
  /** Hydrated from IndexedDB before this component mounts. */
  initial?: BoardInitialState | null;
  /** The invitation this tab opened with, if any. */
  shareToken?: string | null;
  /** Already resolved by the loader for a share link. */
  initialRole?: Role | null;
}

/**
 * The whole seam between React and the engine.
 *
 * React owns one canvas element, the tool, and a copy of the selection. The
 * engine owns the scene, the camera, and every element. No element data lives
 * in React state, so a board with thousands of shapes does not produce
 * thousands of re-renders while drawing.
 */
export function BoardScreen({
  boardId,
  initial,
  shareToken = null,
  initialRole = null,
}: BoardScreenProps) {
  const sceneRef = useRef<Scene | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const controllerRef = useRef<InputController | null>(null);
  const historyRef = useRef<History | null>(null);
  const treeRef = useRef<Quadtree | null>(null);
  const frameRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const collabRef = useRef<CollabSession | null>(null);
  const collabTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roleRef = useRef<Role | null>(initialRole);

  const [tool, setTool] = useState<Tool>(initialRole === "viewer" ? "hand" : "select");
  const [selection, setSelection] = useState<Element[]>([]);
  const [elementCount, setElementCount] = useState(initial?.elements.length ?? 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [role, setRole] = useState<Role | null>(initialRole);
  const [liveStatus, setLiveStatus] = useState<"offline" | "connecting" | "online">("offline");
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const toolRef = useRef<Tool>(initialRole === "viewer" ? "hand" : "select");
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  roleRef.current = role;

  const readOnly = role === "viewer";
  /** The room's head count: this tab is a person too. */
  const people = peers.length + 1;

  // The next visit to `/` opens this notepad, not the shelf.
  useEffect(() => {
    rememberBoard(boardId);
  }, [boardId]);

  /**
   * Preferences are read once from the device, then mirrored into the engine.
   * Keeping a ref means the engine wiring does not need to be rebuilt (and the
   * canvas not re-created) every time a colour changes.
   */
  const updatePreferences = useCallback((patch: Partial<Preferences>) => {
    const next = { ...preferencesRef.current, ...patch };
    preferencesRef.current = next;
    setPreferences(next);
    savePreferences(next);
  }, []);

  const setStyleDefault = useCallback((patch: Partial<Element>) => {
    const style = { ...preferencesRef.current.style, ...patch };
    const next = { ...preferencesRef.current, style };
    preferencesRef.current = next;
    setPreferences(next);
    savePreferences(next);
    controllerRef.current?.setStyle(style);
  }, []);

  const scheduleRender = useCallback(() => {
    if (frameRef.current !== 0) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const controller = controllerRef.current;
      // Trails fade on their own: their frames have no input event to mark the
      // renderer dirty, and an early-returning frame would leave them frozen on
      // screen at their last opacity.
      const effects = controller?.effectsActive() ?? false;
      if (effects) rendererRef.current?.markDirty();
      rendererRef.current?.render();
      if (effects) scheduleRender();
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
      // Local first, Drive and the account a beat later. Each call is a no-op
      // unless that service is connected; a guest viewer never writes at all.
      queueBoardSync(boardId);
      if (roleRef.current !== "viewer") queueServerSync(boardId, shareToken);
    } catch (error) {
      // A board that cannot be written must still be usable. The next edit or
      // an explicit flush retries; the visible chrome reports the problem.
      dirtyRef.current = true;
      useBoardStore.getState().setStatus("unavailable");
      console.warn("PenPaper: could not save board locally", error);
    }
  }, [boardId, shareToken]);

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
    renderer.setLaser(controller.laserTrail);
    renderer.setEraser(controller.eraser);
  }, []);

  const refreshSelection = useCallback(() => {
    const controller = controllerRef.current;
    const selected = controller?.selectedElements ?? [];
    setSelection(selected);
    // Selection is presence, not drawing: it tells the room what this person is
    // about to touch. The session drops an unchanged set on its own.
    collabRef.current?.selection(selected.map((element) => element.id));
    syncOverlays();
    scheduleRender();
  }, [scheduleRender, syncOverlays]);

  /** Mirrors the history stacks into React so the chrome can disable buttons. */
  const refreshHistory = useCallback(() => {
    const history = historyRef.current;
    setCanUndo(history?.canUndo() ?? false);
    setCanRedo(history?.canRedo() ?? false);
  }, []);

  /**
   * Everything the scene holds, tombstones included.
   *
   * `ordered()` is for painting and for snapshots, which drop deleted shapes.
   * The room needs the tombstone too: without it, a peer that was offline when
   * the shape was erased would bring it back on reconnect.
   */
  const collabElements = useCallback((): Element[] => {
    const scene = sceneRef.current;
    return scene ? [...scene.snapshot().values()] : [];
  }, []);

  const pushCollab = useCallback(() => {
    collabTimerRef.current = null;
    collabRef.current?.push(collabElements());
  }, [collabElements]);

  const scheduleCollabPush = useCallback(() => {
    if (!collabRef.current || roleRef.current === "viewer") return;
    if (collabTimerRef.current !== null) return;
    collabTimerRef.current = setTimeout(pushCollab, COLLAB_PUSH_MS);
  }, [pushCollab]);

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
      const preferencesAtStart = preferencesRef.current;
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const renderer = new Renderer(ctx, scene, camera, {
        width: size.width,
        height: size.height,
        dpr: size.dpr,
        theme:
          effectiveTheme(preferencesAtStart.theme, prefersDark) === "dark"
            ? darkTheme
            : lightTheme,
        background: preferencesAtStart.background,
        pattern: preferencesAtStart.layout,
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
          // A live stroke is already in the scene while it is being drawn, so
          // this is what lets another person watch the line arrive.
          scheduleCollabPush();
        },
        onSceneChange: () => {
          reindex();
          refreshStats();
          refreshHistory();
          scheduleSave();
          scheduleRender();
          scheduleCollabPush();
        },
        onSelectionChange: refreshSelection,
        onCreateText: (element) => setEditingId(element.id),
      });

      controller.setTool(toolRef.current);
      controller.setStyle(preferencesAtStart.style);
      controllerRef.current = controller;

      reindex();
      refreshStats();
      refreshHistory();
      scheduleRender();
      setReady(true);
    },
    [
      initial,
      reindex,
      refreshHistory,
      refreshSelection,
      refreshStats,
      scheduleCollabPush,
      scheduleRender,
      scheduleSave,
      syncOverlays,
    ],
  );

  const changeTool = useCallback((next: Tool) => {
    // A viewer link may pan and zoom, never pick up a pen. The toolbar is
    // hidden, but a keyboard shortcut or a stale tool must not get through.
    if (roleRef.current === "viewer" && next !== "hand") return;
    toolRef.current = next;
    setTool(next);
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setTool(next);
    // Choosing a drawing tool is a declaration of intent: the old selection is
    // no longer what the person is about to edit. Leaving it selected would
    // point the style panel at the previous shape while the new tool is armed.
    if (next !== "select" && next !== "hand") controller.setSelection([]);
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

  /**
   * Adopts elements another device wrote into the same board.
   *
   * Never a scene replacement: the canvas is already mounted and may hold a
   * stroke the user is in the middle of. Merged elements arrive per shape, so
   * each one is added or updated in place.
   */
  const adoptElements = useCallback(
    (elements: readonly Element[], removed: readonly string[] = []) => {
      const scene = sceneRef.current;
      if (!scene) return;

      let changed = false;
      for (const element of elements) {
        const current = scene.get(element.id);
        if (!current) {
          scene.add(element);
          changed = true;
        } else if (
          current.updatedAt !== element.updatedAt ||
          current.version !== element.version
        ) {
          // `restore`, not `update`: the incoming copy is already stamped, and
          // re-stamping it here would make this device look like the author of
          // someone else's edit and start an update ping-pong.
          scene.restore(element);
          changed = true;
        }
      }

      for (const id of removed) {
        const current = scene.get(id);
        if (!current || current.isDeleted) continue;
        scene.remove(id);
        changed = true;
      }

      if (!changed) return;
      reindex();
      refreshSelection();
      refreshStats();
      scheduleSave();
      scheduleRender();
    },
    [reindex, refreshSelection, refreshStats, scheduleRender, scheduleSave],
  );

  const undo = useCallback(() => {
    if (historyRef.current?.undo()) afterHistory();
  }, [afterHistory]);

  const redo = useCallback(() => {
    if (historyRef.current?.redo()) afterHistory();
  }, [afterHistory]);

  const resetCanvas = useCallback(() => {
    controllerRef.current?.clearScene();
  }, []);

  /**
   * Export is the visible viewport as painted, with overlays suppressed. A
   * "whole board" export would need an offscreen render sized to the scene;
   * this is honest about being the current view and keeps the button instant.
   */
  const exportPng = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const anchor = document.createElement("a");
    anchor.href = renderer.toDataUrl();
    anchor.download = `penpaper-${boardId}.png`;
    anchor.rel = "noopener";
    anchor.click();
    scheduleRender();
  }, [boardId, scheduleRender]);

  // A phone opens with the pen: "select" on a blank board is a dead tap. A
  // viewer link instead opens with the hand, because watching is all it may do.
  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) changeTool("freedraw");
  }, [changeTool]);

  useEffect(() => {
    if (role === "viewer" && toolRef.current !== "hand") changeTool("hand");
  }, [changeTool, role]);

  /**
   * Live collaboration, second after the board is on screen.
   *
   * Account first, because the socket token route checks ownership. The durable
   * snapshot is merged before the room starts: the first sync then carries one
   * coherent document instead of racing two half-merged ones.
   *
   * Everything here is optional. No account, no token, no secret: the board is
   * exactly the offline notepad it was a moment ago.
   */
  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    let session: CollabSession | null = null;

    (async () => {
      try {
        await useAccountStore.getState().refresh().catch(() => undefined);
        if (cancelled) return;

        const state = useAccountStore.getState();
        const signedIn = Boolean(accountUser());
        if (!shareToken && !signedIn) return;

        // A room needs a registered board. Registering keeps the id already in
        // the address bar, so every link made before sign-in stays valid.
        if (!shareToken) {
          const meta = await loadMeta(boardId).catch(() => null);
          const scene = sceneRef.current;
          const registered = await ensureServerBoard({
            boardId,
            title: meta?.title ?? defaultTitle(boardId),
            elements: scene ? [...scene.snapshot().values()] : [],
          }).catch((error: unknown) => {
            console.warn("PenPaper: could not register this notepad with your account", error);
            return null;
          });
          if (cancelled) return;
          // Null means another account owns this id; this device keeps drawing
          // locally but must not join that board's room.
          if (!registered) return;

          roleRef.current = registered;
          setRole(registered);
        }

        const pulled = await pullServerBoard(boardId, shareToken).catch((error: unknown) => {
          console.warn("PenPaper: could not read the saved notepad", error);
          return null;
        });
        if (cancelled) return;

        if (pulled) {
          // A link decides the role every time it is opened, so a revoked or
          // downgraded invitation takes effect on reconnect.
          if (shareToken) {
            roleRef.current = pulled.role;
            setRole(pulled.role);
          }

          const scene = sceneRef.current;
          const local = scene ? [...scene.snapshot().values()] : [];
          const { elements, changed } = mergeServerElements(local, pulled.elements);
          if (changed) adoptElements(elements);
        }

        if (!state.collab) return;

        const { CollabSession } = await import("@/lib/collab/session");
        if (cancelled) return;

        session = new CollabSession({
          boardId,
          shareToken,
          guestId: guestId(),
          getElements: collabElements,
          onRemote: (elements, removed) => adoptElements(elements, removed),
          onPeers: (next) => setPeers(next),
          onStatus: (status) => setLiveStatus(status),
        });
        collabRef.current = session;
        await session.start();
      } catch (error) {
        // Live is a bonus. A board must never fail to open because a room did.
        console.warn("PenPaper: live collaboration could not start", error);
      }
    })();

    return () => {
      cancelled = true;
      if (collabTimerRef.current !== null) {
        clearTimeout(collabTimerRef.current);
        collabTimerRef.current = null;
      }
      session?.stop();
      if (collabRef.current === session) collabRef.current = null;
      setPeers([]);
      setLiveStatus("offline");
    };
  }, [adoptElements, boardId, collabElements, ready, shareToken]);

  /**
   * Opening a board also reconciles it.
   *
   * Delayed past the first paint so the drawing is on screen before any
   * network work starts, and silent when there is no session: a local board
   * must never wait for Google to open.
   */
  useEffect(() => {
    if (!ready || !hasSession()) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      reconcileBoard(boardId)
        .then((result) => {
          if (!cancelled && result.merged) adoptElements(result.merged);
        })
        .catch((error: unknown) => {
          useSyncStore
            .getState()
            .setPhase("error", error instanceof Error ? error.message : "Sync failed");
        });

      // The rest of the library is not this page's job, but it should not wait
      // for a visit to the shelf either. Long enough after paint to be free.
      window.setTimeout(() => {
        if (!cancelled) syncLibraryInBackground();
      }, 4_000);
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [adoptElements, boardId, ready]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const resolved = effectiveTheme(preferences.theme, media.matches);
      document.documentElement.dataset.theme = resolved;

      // Keep the installed app's status bar in step with an explicit override;
      // the media-based meta tags cannot express "the user chose dark".
      for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
        meta.setAttribute("content", resolved === "dark" ? "#121212" : "#ffffff");
      }

      rendererRef.current?.setTheme(resolved === "dark" ? darkTheme : lightTheme);
      scheduleRender();

      // The default pen follows the paper. Only a default ink is adjusted;
      // a deliberately chosen accent colour is left alone.
      const style = preferencesRef.current.style;
      const defaultInk = resolved === "dark" ? "#e3e3e8" : "#1e1e1e";
      if (
        (style.strokeColor === "#1e1e1e" || style.strokeColor === "#e3e3e8") &&
        style.strokeColor !== defaultInk
      ) {
        setStyleDefault({ strokeColor: defaultInk });
      }
    };

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.theme, scheduleRender, setStyleDefault]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setBackground(preferences.background);
    renderer.setPattern(preferences.layout);
    scheduleRender();
  }, [preferences.background, preferences.layout, scheduleRender]);

  // A hidden tab may be closed without another chance to write, and iOS often
  // kills backgrounded pages outright; flush while the document is still alive.
  useEffect(() => {
    const flushEverything = () => {
      flushSave();
      // A queued stroke must reach the room before the tab sleeps, and the
      // durable snapshot must follow it out.
      if (collabTimerRef.current !== null) {
        clearTimeout(collabTimerRef.current);
        collabTimerRef.current = null;
        collabRef.current?.push(collabElements());
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      flushEverything();
      // Queued Drive and account pushes run now: a backgrounded tab is often
      // closed before its debounce fires, and the board would stay unsynced.
      void flushSyncQueue();
      if (roleRef.current !== "viewer") void flushServerSync();
    };

    window.addEventListener("pagehide", flushEverything);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushEverything);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flushEverything();
    };
  }, [collabElements, flushSave]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }

      // A viewer has no pen, no history, and nothing to delete. Panning and
      // zooming still work through the pointer, which needs no keys.
      if (roleRef.current === "viewer") return;

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

  /**
   * The camera for peers' cursors.
   *
   * Read on every animation frame rather than mirrored into state: panning must
   * move other people's pointers without re-rendering this board's chrome.
   */
  const getCamera = useCallback(
    (): Camera => controllerRef.current?.getCamera() ?? IDENTITY_CAMERA,
    [],
  );

  const onPointerDown = useCallback((input: PointerInput) => {
    controllerRef.current?.pointerDown(input);
  }, []);

  const onPointerMove = useCallback((input: PointerInput) => {
    controllerRef.current?.pointerMove(input);
    const camera = controllerRef.current?.getCamera();
    if (camera) collabRef.current?.cursor(screenToScene(camera, input));
  }, []);

  const onPointerUp = useCallback((input: PointerInput) => {
    controllerRef.current?.pointerUp(input);
  }, []);

  const onPointerCancel = useCallback(() => {
    controllerRef.current?.pointerCancel();
    collabRef.current?.cursor(null);
  }, []);

  const onPointerLeave = useCallback(() => {
    controllerRef.current?.pointerLeave();
    collabRef.current?.cursor(null);
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
    tool === "hand"
      ? "grab"
      : tool === "text"
        ? "text"
        : tool === "select"
          ? "default"
          : tool === "eraser"
            ? "none"
            : "crosshair";

  return (
    <main
      className="relative h-[100dvh] w-full overflow-hidden"
      data-board-id={boardId}
      data-ready={ready}
      data-elements={elementCount}
      data-role={role ?? "local"}
      data-readonly={readOnly}
      data-live={liveStatus}
      data-peers={people}
      style={{ background: "var(--surface-lowest)" }}
    >
      <BoardSurface
        cursor={cursor}
        onReady={handleReady}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onWheel={onWheel}
      />

      {editingElement && !readOnly ? (
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

      <PeerCursors peers={peers} getCamera={getCamera} />

      <BoardChrome
        boardId={boardId}
        tool={tool}
        onToolChange={changeTool}
        selection={selection}
        onPatch={patchSelection}
        onDelete={deleteSelection}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        styleDefaults={preferences.style}
        onStyleDefaultsChange={setStyleDefault}
        isCreating={CREATION_TOOLS.has(tool)}
        menu={{
          theme: preferences.theme,
          onThemeChange: (theme) => updatePreferences({ theme }),
          autoSync: preferences.autoSync,
          onAutoSyncChange: (autoSync) => {
            updatePreferences({ autoSync });
            // Turning the whole library back on should catch up now rather than
            // waiting for the next visit.
            if (autoSync) syncLibraryInBackground();
          },
          background: preferences.background,
          onBackgroundChange: (background) => updatePreferences({ background }),
          layout: preferences.layout,
          onLayoutChange: (layout) => updatePreferences({ layout }),
          onExport: exportPng,
          onReset: resetCanvas,
        }}
        role={role}
        readOnly={readOnly}
        peers={people}
        liveStatus={liveStatus}
        onShare={() => setShareOpen(true)}
      />

      <ShareDialog
        boardId={boardId}
        role={role}
        open={shareOpen}
        peers={people}
        onClose={() => setShareOpen(false)}
      />
    </main>
  );
}
