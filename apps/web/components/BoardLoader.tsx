"use client";

import { useEffect, useState } from "react";
import {
  deserializeScene,
  fitCamera,
  SCENE_VERSION,
  Scene,
  type Camera,
  type ViewInsets,
} from "@penpaper/engine";
import type { Element } from "@penpaper/shared";
import { createDemoElements } from "@/lib/demo-board";
import { loadBoard, saveBoard } from "@/lib/storage";
import { useBoardStore } from "@/store/board-store";
import { BoardScreen, type BoardInitialState } from "./BoardScreen";

const IDENTITY_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/**
 * Demo content is laid out for a phone, so on a desktop the unmodified origin
 * puts it under the dock in the top-left corner. Fit it into the space the
 * fixed chrome leaves free instead.
 */
function demoCamera(elements: Element[]): Camera {
  const scene = new Scene();
  for (const element of elements) scene.add(element);

  const bounds = scene.bounds() ?? { x: 0, y: 0, width: 1, height: 1 };
  const width = window.innerWidth;
  const height = window.innerHeight;

  let insets: ViewInsets;
  if (width >= 1024) insets = { top: 64, right: 80, bottom: 64, left: 96 };
  else if (width >= 520) insets = { top: 64, right: 24, bottom: 96, left: 24 };
  else insets = { top: 64, right: 16, bottom: 176, left: 16 };

  return fitCamera(bounds, { width, height }, insets, 1);
}

const isUntouched = (camera: Camera): boolean =>
  camera.x === 0 && camera.y === 0 && camera.zoom === 1;

/**
 * Loads the device copy before the canvas exists.
 *
 * The alternative — mounting an empty board and pouring elements in later — is
 * exactly the blank flash a local-first app must not have: the user sees an
 * empty canvas, starts drawing, and then their shapes appear on top of it.
 * `undefined` means "still reading", `null` means "nothing saved".
 */
export function BoardLoader({ boardId }: { boardId: string }) {
  const [hydrated, setHydrated] = useState<BoardInitialState | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    useBoardStore.getState().setBoard(boardId);

    loadBoard(boardId)
      .then(async (snapshot) => {
        if (cancelled) return;

        if (!snapshot) {
          useBoardStore.getState().setStatus("ready");

          if (boardId === "demo") {
            // Seed the demo once, then treat it like any other local board so
            // edits and the camera survive a reload. Persist before mounting
            // so a quick first edit cannot race the seed write.
            const elements = createDemoElements();
            const camera = demoCamera(elements);
            try {
              await saveBoard(boardId, {
                version: SCENE_VERSION,
                elements,
                camera,
                savedAt: Date.now(),
              });
            } catch (error) {
              console.warn("PenPaper: could not save the demo board locally", error);
            }
            if (cancelled) return;
            setHydrated({ elements, camera });
            return;
          }

          setHydrated(null);
          return;
        }

        try {
          // Re-validate through the engine's reader: a snapshot written by an
          // older build should be repaired, and a corrupt one should not take
          // the board down with it.
          const scene = deserializeScene(
            JSON.stringify({ version: SCENE_VERSION, elements: snapshot.elements }),
          );
          const elements = scene.ordered();
          const storedCamera = snapshot.camera ?? IDENTITY_CAMERA;
          // Boards written before the demo was centred, and a first open that
          // races the save, both carry the identity camera. Treat it as "the
          // user has not moved the view yet" rather than persisting the
          // top-left corner forever.
          const camera =
            boardId === "demo" && isUntouched(storedCamera) && elements.length > 0
              ? demoCamera(elements)
              : storedCamera;

          if (camera !== storedCamera) {
            // Persist the centred view so a reload opens in the same place and
            // the stored camera is no longer the "untouched" sentinel.
            try {
              await saveBoard(boardId, { ...snapshot, camera, savedAt: Date.now() });
            } catch (error) {
              console.warn("PenPaper: could not update the demo camera", error);
            }
          }

          if (cancelled) return;
          useBoardStore.getState().setStatus("ready");
          setHydrated({ elements, camera });
        } catch (error) {
          console.warn("PenPaper: ignoring an unreadable local board", error);
          useBoardStore.getState().setStatus("ready");
          setHydrated(null);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        // Private mode or a blocked storage partition still gets a usable,
        // in-memory board; only persistence is lost.
        console.warn("PenPaper: local storage is unavailable", error);
        useBoardStore.getState().setStatus("unavailable");
        setHydrated(null);
      });

    return () => {
      cancelled = true;
    };
  }, [boardId]);

  if (hydrated === undefined) return <BoardSkeleton />;

  return <BoardScreen boardId={boardId} initial={hydrated} />;
}

function BoardSkeleton() {
  return (
    <main
      className="grid h-[100dvh] w-full place-items-center"
      data-testid="board-skeleton"
      aria-busy="true"
      aria-live="polite"
      style={{ background: "var(--surface-lowest)" }}
    >
      <div className="flex flex-col items-center gap-3">
        <span
          aria-hidden="true"
          className="h-8 w-8 animate-pulse rounded-[10px]"
          style={{ background: "var(--surface-container)" }}
        />
        <p className="text-sm" style={{ color: "var(--on-surface-muted)" }}>
          Opening your board…
        </p>
      </div>
    </main>
  );
}
