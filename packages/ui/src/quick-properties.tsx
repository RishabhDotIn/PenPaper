"use client";

import type { Element } from "@penpaper/shared";
import { STROKE_COLORS } from "./properties-panel";

export interface QuickPropertiesProps {
  value: Element;
  onStroke: (color: string) => void;
  onOpenStyles: () => void;
  onDelete?: () => void;
  /** Selection editing or the style defaults for the active drawing tool. */
  mode?: "selection" | "default";
}

/**
 * The compact style bar.
 *
 * A full-height sheet used to open on every selection — including immediately
 * after every pen stroke — which hid half the board while drawing. This pill
 * keeps the two edits that matter in the middle of a sketch (colour, delete)
 * one tap away and puts the rest behind an explicit "Style" button. With a
 * drawing tool active it edits the style of the *next* element, so a colour
 * can be chosen before the stroke exists.
 *
 * The pill hugs its content instead of spanning the viewport: the same
 * component is used on phones, tablets, and narrow desktop windows, where a
 * full-width bar would leave a wide empty band.
 */
export function QuickProperties({
  value,
  onStroke,
  onOpenStyles,
  onDelete,
  mode = "selection",
}: QuickPropertiesProps) {
  return (
    <div
      className="pp-quick"
      data-testid="quick-properties"
      aria-label={mode === "default" ? "Quick style" : "Quick properties"}
    >
      <div className="pp-quick-strokes" role="group" aria-label="Stroke colour">
        {STROKE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className="pp-quick-swatch"
            style={{ background: color }}
            aria-label={`Stroke ${color}`}
            aria-pressed={value.strokeColor === color}
            onClick={() => onStroke(color)}
          />
        ))}
      </div>

      <span className="pp-quick-sep" aria-hidden="true" />

      {onDelete ? (
        <button
          type="button"
          className="pp-quick-action pp-quick-delete"
          aria-label="Delete selection"
          onClick={onDelete}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 7h14" />
            <path d="M9 7V5h6v2" />
            <path d="M7 7l.8 12h8.4L17 7" />
            <path d="M10 10v6M14 10v6" />
          </svg>
        </button>
      ) : null}

      <button type="button" className="pp-quick-action pp-quick-more" onClick={onOpenStyles}>
        Style
      </button>
    </div>
  );
}
