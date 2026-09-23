"use client";

import { BottomSheet, PropertiesPanel, QuickProperties, Toolbar } from "@penpaper/ui";
import type { Tool } from "@penpaper/engine";
import type { Element } from "@penpaper/shared";
import { useEffect, useState } from "react";

export interface BoardChromeProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  selection: readonly Element[];
  onPatch: (patch: Partial<Element>) => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * The floating chrome over the canvas.
 *
 * Layout is CSS, not React: the dock and the properties panel choose their own
 * side of the breakpoint, so resizing a window never remounts a component and
 * never loses focus in the properties form.
 */
export function BoardChrome({
  tool,
  onToolChange,
  selection,
  onPatch,
  onDelete,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: BoardChromeProps) {
  const [stylesOpen, setStylesOpen] = useState(false);

  // Losing the selection (a tap on empty canvas, a delete) must also dismiss
  // the sheet; leaving it open over an empty canvas hides the board for nothing.
  useEffect(() => {
    if (selection.length === 0) setStylesOpen(false);
  }, [selection.length]);

  return (
    <>
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <div
          className="pointer-events-auto rounded-[var(--radius-island)] px-3 py-2 text-sm font-medium"
          style={{ background: "var(--island-bg)", boxShadow: "var(--shadow-island)" }}
        >
          <span style={{ color: "var(--primary)" }}>Pen</span>
          <span>Paper</span>
        </div>
      </header>

      <div className="pp-history" data-testid="history-controls" role="group" aria-label="History">
        <button
          type="button"
          className="pp-history-button"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 7 4.5 11.5 9 16" />
            <path d="M4.5 11.5H15a4.5 4.5 0 0 1 0 9h-2" />
          </svg>
        </button>
        <button
          type="button"
          className="pp-history-button"
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 7l4.5 4.5L15 16" />
            <path d="M19.5 11.5H9a4.5 4.5 0 0 0 0 9h2" />
          </svg>
        </button>
      </div>

      <Toolbar value={tool} onChange={onToolChange} />

      {/* Excalidraw's panel only exists while something is selected. Keeping an
          empty one on screen covers the canvas with a dead slab on a tablet and
          gives the eye nothing to read. */}
      {selection.length > 0 ? (
        <aside className="pp-properties-desktop" aria-label="Properties">
          <PropertiesPanel selection={selection} onPatch={onPatch} onDelete={onDelete} />
        </aside>
      ) : null}

      <div className="pp-properties-mobile">
        {selection.length > 0 ? (
          <>
            <QuickProperties
              selection={selection}
              onPatch={onPatch}
              onOpenStyles={() => setStylesOpen(true)}
              onDelete={onDelete}
            />
            {stylesOpen ? (
              <BottomSheet label="Style" initialSnap="half" onClose={() => setStylesOpen(false)}>
                <PropertiesPanel
                  selection={selection}
                  onPatch={onPatch}
                  onDelete={onDelete}
                  showTitle={false}
                />
              </BottomSheet>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
