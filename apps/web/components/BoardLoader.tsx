"use client";

import Link from "next/link";
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
import { accountUser, useAccountStore } from "@/lib/collab/account";
import type { Role } from "@/lib/collab/api";
import {
  mergeServerElements,
  pullServerBoard,
  rememberShareToken,
} from "@/lib/collab/board-sync";
import { createDemoElements } from "@/lib/demo-board";
import { markDemoSeen } from "@/lib/library";
import { loadBoard, saveBoard } from "@/lib/storage";
import { hasSession } from "@/lib/drive/auth";
import { pullBoardById } from "@/lib/drive/sync";
import { useBoardStore } from "@/store/board-store";
import { BoardScreen, type BoardInitialState } from "./BoardScreen";

const IDENTITY_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/**
 * Demo content is laid out for a phone, so on a desktop the unmodified origin
 * puts it under the dock in the top-left corner. Fit it into the space the
 * fixed chrome leaves free instead. The same fit makes a server-only board that
 * was drawn on a laptop open sensibly on a phone.
 */
function fittedCamera(elements: Element[]): Camera {
  if (elements.length === 0) return IDENTITY_CAMERA;

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

function demoCamera(elements: Element[]): Camera {
  return fittedCamera(elements);
}

const isUntouched = (camera: Camera): boolean =>
  camera.x === 0 && camera.y === 0 && camera.zoom === 1;

type Loaded =
  | { kind: "ready"; initial: BoardInitialState | null; role: Role | null }
  | { kind: "denied" }
  | { kind: "unreachable" };

export interface BoardLoaderProps {
  boardId: string;
  /** A guest's invitation from `/s/<token>`, carried through the board URL. */
  shareToken?: string | null;
}

/**
 * Loads the device copy before the canvas exists.
 *
 * The alternative — mounting an empty board and pouring elements in later — is
 * exactly the blank flash a local-first app must not have: the user sees an
 * empty canvas, starts drawing, and then their shapes appear on top of it.
 * `undefined` means "still reading", `null` means "nothing saved".
 *
 * A share link is the one case that waits for the network first. Mounting a
 * viewer for a frame with the pen in hand would be worse than a moment of
 * skeleton: a shape drawn there would be a save the link cannot make.
 */
export function BoardLoader({ boardId, shareToken = null }: BoardLoaderProps) {
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    useBoardStore.getState().setBoard(boardId);
    rememberShareToken(boardId, shareToken);

    const finish = (next: Loaded, storageBroken = false) => {
      if (cancelled) return;
      useBoardStore.getState().setStatus(storageBroken ? "unavailable" : "ready");
      setLoaded(next);
    };

    (async () => {
      let snapshot: Awaited<ReturnType<typeof loadBoard>> = null;
      let storageBroken = false;

      try {
        snapshot = await loadBoard(boardId);
      } catch (error) {
        console.warn("PenPaper: local storage is unavailable", error);
        storageBroken = true;
      }

      if (cancelled) return;

      // A share link is the server's invitation. Resolve it before mounting so
      // an expired link says so, and a live one knows whether it may draw.
      if (shareToken) {
        try {
          const pulled = await pullServerBoard(boardId, shareToken);
          if (cancelled) return;
          if (!pulled) {
            finish({ kind: "denied" });
            return;
          }

          const local = snapshot?.elements ?? [];
          const { elements, changed } = mergeServerElements(local, pulled.elements);
          const camera = snapshot ? snapshot.camera : fittedCamera(elements);

          if (!snapshot || changed) {
            await saveBoard(boardId, {
              version: SCENE_VERSION,
              elements,
              camera,
              savedAt: Date.now(),
            }).catch((error: unknown) => {
              console.warn("PenPaper: could not keep the shared notepad on this device", error);
            });
          }

          if (cancelled) return;
          finish({ kind: "ready", initial: { elements, camera }, role: pulled.role }, storageBroken);
        } catch (error) {
          // Offline is not "not allowed": keep the link and let a retry decide.
          console.warn("PenPaper: could not reach the shared notepad", error);
          finish({ kind: "unreachable" });
        }
        return;
      }

      if (snapshot) {
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
            await saveBoard(boardId, { ...snapshot, camera, savedAt: Date.now() }).catch(
              (error: unknown) => {
                console.warn("PenPaper: could not update the demo camera", error);
              },
            );
          }

          if (cancelled) return;
          finish({ kind: "ready", initial: { elements, camera }, role: null });
        } catch (error) {
          console.warn("PenPaper: ignoring an unreadable local board", error);
          finish({ kind: "ready", initial: null, role: null });
        }
        return;
      }

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
        markDemoSeen();
        if (cancelled) return;
        finish({ kind: "ready", initial: { elements, camera }, role: null });
        return;
      }

      // Nothing on this device. Ask who this is, then check the account first:
      // a board opened on a second device lives there, not in Drive.
      await useAccountStore.getState().refresh().catch(() => undefined);
      if (cancelled) return;

      if (accountUser()) {
        const pulled = await pullServerBoard(boardId).catch((error: unknown) => {
          console.warn("PenPaper: could not open your account copy", error);
          return null;
        });
        if (cancelled) return;
        if (pulled) {
          const elements = pulled.elements;
          const camera = fittedCamera(elements);
          await saveBoard(boardId, {
            version: SCENE_VERSION,
            elements,
            camera,
            savedAt: Date.now(),
          }).catch((error: unknown) => {
            console.warn("PenPaper: could not keep the notepad on this device", error);
          });
          if (cancelled) return;
          finish({ kind: "ready", initial: { elements, camera }, role: pulled.role }, storageBroken);
          return;
        }
      }

      // Not on this device and not in the account. Drive may still have it: the
      // board id in the URL is enough to find the file.
      if (hasSession()) {
        const pulled = await pullBoardById(boardId).catch((error: unknown) => {
          console.warn("PenPaper: could not open the Drive copy", error);
          return null;
        });
        if (cancelled) return;
        if (pulled) {
          finish(
            { kind: "ready", initial: { elements: pulled.elements, camera: pulled.camera }, role: null },
            storageBroken,
          );
          return;
        }
      }

      finish({ kind: "ready", initial: null, role: null }, storageBroken);
    })();

    return () => {
      cancelled = true;
    };
  }, [boardId, shareToken]);

  if (loaded === undefined) return <BoardSkeleton />;
  if (loaded.kind === "denied") {
    return (
      <BoardMessage
        title="This link is not available"
        copy="The owner may have turned it off, or the notepad was deleted. Ask for a fresh link."
      />
    );
  }
  if (loaded.kind === "unreachable") {
    return (
      <BoardMessage
        title="Could not reach this notepad"
        copy="PenPaper could not reach its server. Your own notepads still open offline."
        retry
      />
    );
  }

  return (
    <BoardScreen
      boardId={boardId}
      initial={loaded.initial}
      shareToken={shareToken}
      initialRole={loaded.role}
    />
  );
}

function BoardMessage({
  title,
  copy,
  retry,
}: {
  title: string;
  copy: string;
  retry?: boolean;
}) {
  return (
    <main
      className="grid h-[100dvh] w-full place-items-center p-5"
      style={{ background: "var(--surface-lowest)", color: "var(--on-surface)" }}
      data-testid="board-message"
    >
      <section
        className="w-full max-w-[380px] rounded-3xl p-6"
        style={{ background: "var(--glass-tint)", boxShadow: "var(--glass-shadow)" }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--primary)" }}>
          PenPaper
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--on-surface-muted)" }}>
          {copy}
        </p>
        <div className="mt-5 flex gap-2">
          {retry ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold"
              style={{ background: "var(--primary)", color: "var(--on-primary)" }}
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          ) : null}
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold"
            style={{ background: "var(--surface-low)", color: "var(--on-surface)" }}
          >
            Open my notepads
          </Link>
        </div>
      </section>
    </main>
  );
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
