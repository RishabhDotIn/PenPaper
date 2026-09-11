"use client";

import { BoardSurface, type SurfaceSize } from "@/components/BoardSurface";
import { Renderer, Scene, darkTheme, lightTheme } from "@penpaper/engine";
import { useCallback, useRef } from "react";

/**
 * The board route.
 *
 * Phase 1 grows the interaction layer into this shell. Right now it proves the
 * full pipeline end to end: surface sizing, camera transform, grid, and a
 * dirty-frame renderer that does nothing while the board is idle.
 */
export default function BoardPage() {
  const sceneRef = useRef<Scene | null>(null);
  const rendererRef = useRef<Renderer | null>(null);

  const handleReady = useCallback((ctx: CanvasRenderingContext2D, size: SurfaceSize) => {
    const scene = sceneRef.current ?? new Scene();
    sceneRef.current = scene;

    const existing = rendererRef.current;
    if (existing) {
      existing.setSize(size.width, size.height, size.dpr);
      existing.render();
      return;
    }

    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;

    const renderer = new Renderer(ctx, scene, { x: 0, y: 0, zoom: 1 }, {
      width: size.width,
      height: size.height,
      theme: prefersDark ? darkTheme : lightTheme,
    });

    rendererRef.current = renderer;
    renderer.render();
  }, []);

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden">
      <BoardSurface onReady={handleReady} />

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
