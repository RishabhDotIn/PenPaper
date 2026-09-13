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
}

const PEEK_HEIGHT = 72;

function initialTransform(point: SnapPoint): string {
  if (point === "full") return "translateY(0)";
  if (point === "half") return "translateY(50%)";
  return `translateY(calc(100% - ${PEEK_HEIGHT}px))`;
}

/**
 * A drag-to-snap sheet for the properties panel on phones.
 *
 * The transform is written straight to the element during the drag, and React
 * state only changes when the sheet settles on a snap point. Re-rendering a
 * form on every pointer move is what makes mobile sheets feel sticky.
 */
export function BottomSheet({
  children,
  snapPoints = ["peek", "half", "full"],
  initialSnap = "peek",
  label = "Style",
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; baseY: number; height: number; currentY: number } | null>(
    null,
  );
  const [snap, setSnap] = useState<SnapPoint>(initialSnap);

  const offsetFor = useCallback(
    (point: SnapPoint, height: number): number => {
      if (point === "full") return 0;
      if (point === "half") return height / 2;
      return Math.max(0, height - PEEK_HEIGHT);
    },
    [],
  );

  const apply = useCallback(
    (point: SnapPoint) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      const height = sheet.getBoundingClientRect().height;
      sheet.style.transform = `translateY(${offsetFor(point, height)}px)`;
    },
    [offsetFor],
  );

  useEffect(() => {
    apply(snap);

    const sheet = sheetRef.current;
    if (!sheet || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => apply(snap));
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [apply, snap]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const height = sheet.getBoundingClientRect().height;
    const baseY = offsetFor(snap, height);

    dragRef.current = { startY: event.clientY, baseY, height, currentY: baseY };
    sheet.style.transition = "none";
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet) return;

    const next = Math.min(
      Math.max(0, drag.baseY + event.clientY - drag.startY),
      Math.max(0, drag.height - PEEK_HEIGHT),
    );

    drag.currentY = next;
    sheet.style.transform = `translateY(${next}px)`;
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
      const distance = Math.abs(offsetFor(point, drag.height) - drag.currentY);
      if (distance < best) {
        best = distance;
        nearest = point;
      }
    }

    // Restore the CSS transition so the settle animates; the effect applies
    // the final position for the new state.
    sheet.style.transition = "";
    setSnap(nearest);
    sheet.style.transform = `translateY(${offsetFor(nearest, drag.height)}px)`;
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
      style={{ transform: initialTransform(initialSnap) }}
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
      <h2 className="pp-sheet-title">{label}</h2>
      <div className="pp-sheet-content">{children}</div>
    </div>
  );
}
