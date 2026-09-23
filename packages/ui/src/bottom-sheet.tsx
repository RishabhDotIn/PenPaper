"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export type SnapPoint = "peek" | "half" | "full";

export interface BottomSheetProps {
  children: ReactNode;
  snapPoints?: readonly SnapPoint[];
  initialSnap?: SnapPoint;
  label?: string;
  /** When provided, renders a close button and lets the sheet be dismissed. */
  onClose?: () => void;
}

const PEEK_HEIGHT = 72;

/**
 * Height, not transform.
 *
 * The sheet is anchored above the dock, so translating it would push its
 * scroll area below the viewport and make the last controls unreachable.
 * Resizing the box keeps the visible area equal to the scrollable area at every
 * snap point, which is the only version that works with a long properties form.
 */
function initialHeight(point: SnapPoint): string {
  if (point === "full") return "calc(100dvh - 60px - env(safe-area-inset-bottom))";
  if (point === "half") return "50vh";
  return `${PEEK_HEIGHT}px`;
}

export function BottomSheet({
  children,
  snapPoints = ["peek", "half", "full"],
  initialSnap = "peek",
  label = "Style",
  onClose,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; baseHeight: number; height: number } | null>(null);
  const [snap, setSnap] = useState<SnapPoint>(initialSnap);

  const maxHeight = useCallback((): number => {
    const sheet = sheetRef.current;
    if (!sheet) return 0;
    // The sheet is bottom-anchored, so the y of its bottom edge is exactly the
    // room available above it, whatever height it currently has.
    return sheet.getBoundingClientRect().bottom;
  }, []);

  const heightFor = useCallback(
    (point: SnapPoint): number => {
      const max = maxHeight();
      if (point === "peek") return Math.min(PEEK_HEIGHT, max);
      if (point === "half") return Math.min(Math.round(window.innerHeight / 2), max);
      return Math.max(PEEK_HEIGHT, max);
    },
    [maxHeight],
  );

  const apply = useCallback(
    (point: SnapPoint) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      sheet.style.height = `${heightFor(point)}px`;
    },
    [heightFor],
  );

  useEffect(() => {
    apply(snap);

    const onResize = () => apply(snap);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [apply, snap]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const height = sheet.getBoundingClientRect().height;

    dragRef.current = { startY: event.clientY, baseHeight: height, height };
    sheet.style.transition = "none";
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet) return;

    // Down drags the sheet closed, so the delta is inverted.
    const next = Math.min(
      Math.max(PEEK_HEIGHT, drag.baseHeight + (drag.startY - event.clientY)),
      maxHeight(),
    );

    drag.height = next;
    sheet.style.height = `${next}px`;
  };

  const settle = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    dragRef.current = null;
    if (!drag || !sheet) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    let nearest = snapPoints[0] ?? "peek";
    let best = Number.POSITIVE_INFINITY;

    for (const point of snapPoints) {
      const distance = Math.abs(heightFor(point) - drag.height);
      if (distance < best) {
        best = distance;
        nearest = point;
      }
    }

    sheet.style.transition = "";
    setSnap(nearest);
    sheet.style.height = `${heightFor(nearest)}px`;
  };

  return (
    <div
      ref={sheetRef}
      className="pp-sheet"
      data-testid="properties-sheet"
      data-snap={snap}
      aria-label={label}
      role="dialog"
      aria-modal="false"
      style={{ height: initialHeight(initialSnap) }}
    >
      <div
        className="pp-sheet-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to resize the panel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={settle}
        onPointerCancel={settle}
      />
      <h2 className="pp-sheet-title">
        {label}
        {onClose ? (
          <button type="button" className="pp-sheet-close" aria-label="Close styles" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : null}
      </h2>
      <div className="pp-sheet-content">{children}</div>
    </div>
  );
}
