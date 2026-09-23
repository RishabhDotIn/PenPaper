"use client";

import { computeBackingSize, type PointerInput, type WheelInput } from "@penpaper/engine";
import { useEffect, useRef } from "react";

export interface SurfaceSize {
  /** CSS pixels. */
  width: number;
  height: number;
  /** The ratio actually used after capping. */
  dpr: number;
}

export interface BoardSurfaceProps {
  onReady: (ctx: CanvasRenderingContext2D, size: SurfaceSize) => void;
  /** Tier C devices pass 1.5 (design doc 6.5). */
  maxDpr?: number;
  /** CSS cursor for the active tool. */
  cursor?: string;
  onPointerDown?: (input: PointerInput, event: PointerEvent) => void;
  onPointerMove?: (input: PointerInput) => void;
  onPointerUp?: (input: PointerInput) => void;
  onPointerCancel?: () => void;
  onWheel?: (input: WheelInput) => void;
}

function toPointerInput(event: PointerEvent, rect: DOMRect): PointerInput {
  return {
    id: event.pointerId,
    type: (event.pointerType || "mouse") as PointerInput["type"],
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    // A mouse reports 0 while no button is down; the engine wants a usable
    // constant so a stroke has consistent width.
    pressure: event.pressure > 0 ? event.pressure : 0.5,
    shift: event.shiftKey,
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
  };
}

/**
 * Owns the canvas element, its size, and the DOM plumbing.
 *
 * Input is translated to the engine's `PointerInput` here and nowhere else, so
 * every tool sees identical data regardless of device, and the engine never
 * imports a DOM type.
 */
export function BoardSurface({ onReady, maxDpr = 2, cursor = "default", ...handlers }: BoardSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handlersRef = useRef(handlers);
  const onReadyRef = useRef(onReady);
  const lastSizeRef = useRef({ width: 0, height: 0, dpr: 0 });

  handlersRef.current = handlers;
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
      if (last.width === size.width && last.height === size.height && last.dpr === size.dpr) {
        return;
      }
      lastSizeRef.current = size;

      // Assigning these clears the canvas, so only on a real change.
      canvas.width = size.width;
      canvas.height = size.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      onReadyRef.current(ctx, { width: rect.width, height: rect.height, dpr: size.dpr });
    };

    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(parent);

    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    media.addEventListener("change", apply);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", apply);
    };
  }, [maxDpr]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const down = (event: PointerEvent) => {
      // Keep receiving moves when the pointer leaves the canvas mid-drag.
      canvas.setPointerCapture(event.pointerId);
      handlersRef.current.onPointerDown?.(toPointerInput(event, canvas.getBoundingClientRect()), event);
    };

    const move = (event: PointerEvent) => {
      handlersRef.current.onPointerMove?.(toPointerInput(event, canvas.getBoundingClientRect()));
    };

    const up = (event: PointerEvent) => {
      handlersRef.current.onPointerUp?.(toPointerInput(event, canvas.getBoundingClientRect()));
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };

    const cancel = () => handlersRef.current.onPointerCancel?.();

    const wheel = (event: WheelEvent) => {
      // Non-passive so the page cannot scroll or zoom underneath the board.
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      handlersRef.current.onWheel?.({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey,
      });
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", cancel);
    canvas.addEventListener("wheel", wheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("wheel", wheel);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      // touch-none lives on the canvas only: the page must never eat a drag,
      // and the surrounding shell must still be able to scroll.
      className="absolute inset-0 block h-full w-full touch-none"
      style={{ cursor }}
      onContextMenu={(event) => event.preventDefault()}
      aria-label="Whiteboard canvas"
      role="application"
    />
  );
}
