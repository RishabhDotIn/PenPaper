"use client";

import type { ReactNode } from "react";

export interface StylePopoverProps {
  children: ReactNode;
  label?: string;
  /** False keeps the card mounted while its exit animation plays. */
  open?: boolean;
}

/**
 * The touch-width style card.
 *
 * It drops from the palette button that opened it and sizes to its content
 * instead of filling a slab at the bottom of the screen. Dismissal belongs to
 * the caller: a tap outside, Escape, or picking another tool closes it, so the
 * card needs no grabber and no close button of its own.
 */
export function StylePopover({ children, label = "Style", open = true }: StylePopoverProps) {
  return (
    <div
      className="pp-popover"
      data-testid="style-popover"
      data-state={open ? "open" : "closed"}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="pp-popover-content">{children}</div>
    </div>
  );
}
