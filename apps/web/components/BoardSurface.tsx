"use client";

import { computeBackingSize } from "@penpaper/engine";
import { useEffect, useRef } from "react";

export interface SurfaceSize {
  /** CSS pixels. */
  width: number;
  height: number;
  /** The ratio actually used after capping. */
  dpr: number;
}

interface BoardSurfaceProps {
  onReady: (ctx: CanvasRenderingContext2D, size: SurfaceSize) => void;
  /** Tier C devices pass 1.5 (design doc 6.5). */
  maxDpr?: number;
}

/**
 * Owns the canvas element and nothing else.
 *
 * Sizing is deliberately separate from rendering: the backing store is
 * resized only when the CSS box or the DPR actually changes, because assigning
 * `canvas.width` clears the bitmap and costs a full reallocation.
 */
export function BoardSurface({ onReady, maxDpr = 2 }: BoardSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onReadyRef = useRef(onReady);
  const lastSizeRef = useRef({ width: 0, height: 0, dpr: 0 });

  onReadyRef.current = onReady;

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const apply = () => {
      const rect = parent.getBoundingClientRect();
      const size = computeBackingSize(
        rect.width,
        rect.height,
        window.devicePixelRatio || 1,
        maxDpr,
      );

      const last = lastSizeRef.current;
      const unchanged =
        last.width === size.width && last.height === size.height && last.dpr === size.dpr;
      if (unchanged) return;
      lastSizeRef.current = size;

      // Assigning these clears the canvas, so only do it on a real change.
      canvas.width = size.width;
      canvas.height = size.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Draw in CSS pixels; the backing store handles the device ratio.
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      onReadyRef.current(ctx, { width: rect.width, height: rect.height, dpr: size.dpr });
    };

    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(parent);

    // Fires when a window moves between displays with different pixel ratios.
    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    media.addEventListener("change", apply);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", apply);
    };
  }, [maxDpr]);

  return (
    <canvas
      ref={canvasRef}
      // touch-none lives on the canvas only: the page must never eat a drag,
      // and the surrounding shell must still be able to scroll.
      className="absolute inset-0 block h-full w-full touch-none"
      aria-label="Whiteboard canvas"
      role="img"
    />
  );
}
