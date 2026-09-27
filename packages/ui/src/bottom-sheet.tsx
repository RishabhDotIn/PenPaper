"use client";

import type { ReactNode } from "react";

export interface BottomSheetProps {
  children: ReactNode;
  label?: string;
  /** When provided, renders a close button and lets the sheet be dismissed. */
  onClose?: () => void;
}

/**
 * The touch-width style card.
 *
 * It sizes to its content instead of filling a fixed half-screen slab: the
 * sheet used to open at 50 vh and clip the last section behind a scrollbar,
 * which looked like a broken form rather than a popover. Only a tall selection
 * (text or arrows, with their extra sections) scrolls, and then inside the card.
 *
 * There is no drag handle: dragging a content-sized card cannot do anything
 * useful, and the handle was the main visual reminder of the old sheet. The
 * grabber stays as a quiet affordance that this is a floating layer.
 */
export function BottomSheet({ children, label = "Style", onClose }: BottomSheetProps) {
  return (
    <div
      className="pp-sheet"
      data-testid="properties-sheet"
      aria-label={label}
      role="dialog"
      aria-modal="false"
    >
      <div className="pp-sheet-handle" aria-hidden="true" />
      {onClose ? (
        <button type="button" className="pp-sheet-close" aria-label="Close styles" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      ) : null}
      <div className="pp-sheet-content">{children}</div>
    </div>
  );
}
