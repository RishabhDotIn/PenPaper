"use client";

import { useEffect, useState } from "react";
import { deserializeScene, SCENE_VERSION, type Camera } from "@penpaper/engine";
import { loadBoard } from "@/lib/storage";
import { useBoardStore } from "@/store/board-store";
import { BoardScreen, type BoardInitialState } from "./BoardScreen";

const IDENTITY_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

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
      .then((snapshot) => {
        if (cancelled) return;

        if (!snapshot) {
          useBoardStore.getState().setStatus("ready");
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
          useBoardStore.getState().setStatus("ready");
          setHydrated({ elements: scene.ordered(), camera: snapshot.camera ?? IDENTITY_CAMERA });
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
