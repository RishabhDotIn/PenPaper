"use client";

import { BottomSheet, PropertiesPanel, Toolbar } from "@penpaper/ui";
import type { Tool } from "@penpaper/engine";
import type { Element } from "@penpaper/shared";

export interface BoardChromeProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  selection: readonly Element[];
  onPatch: (patch: Partial<Element>) => void;
  onDelete: () => void;
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
}: BoardChromeProps) {
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

      <Toolbar value={tool} onChange={onToolChange} />

      <aside className="pp-properties-desktop" aria-label="Properties">
        <PropertiesPanel selection={selection} onPatch={onPatch} onDelete={onDelete} />
      </aside>

      <div className="pp-properties-mobile">
        {selection.length > 0 ? (
          <BottomSheet label="Style">
            <PropertiesPanel selection={selection} onPatch={onPatch} onDelete={onDelete} />
          </BottomSheet>
        ) : null}
      </div>
    </>
  );
}
