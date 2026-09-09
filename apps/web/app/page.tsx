"use client";

import { BoardSurface, type SurfaceSize } from "@/components/BoardSurface";
import { useCallback, useRef } from "react";

/**
 * The board route.
 *
 * Phase 1 grows a renderer into this shell; for now it proves the surface
 * sizes correctly at every viewport and DPR, which is the thing every later
 * task depends on.
 */
export default function BoardPage() {
  const sizeRef = useRef<SurfaceSize | null>(null);

  const handleReady = useCallback((ctx: CanvasRenderingContext2D, size: SurfaceSize) => {
    sizeRef.current = size;

    // A quiet backdrop so the canvas is visibly alive before the renderer
    // exists. The real grid arrives with the renderer.
    ctx.save();
    ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue("--surface-lowest")
      .trim();
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.restore();
  }, []);

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden">
      <BoardSurface onReady={handleReady} />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center pt-4">
        <div
          className="pointer-events-auto rounded-[var(--radius-island)] px-3 py-2 text-sm font-medium"
          style={{
            background: "var(--island-bg)",
            boxShadow: "var(--shadow-island)",
            paddingTop: "max(0.5rem, env(safe-area-inset-top))",
          }}
        >
          <span style={{ color: "var(--primary)" }}>Pen</span>
          <span>Paper</span>
        </div>
      </div>
    </main>
  );
}
