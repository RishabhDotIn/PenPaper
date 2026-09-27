"use client";

import {
  AppMenu,
  BottomSheet,
  PaletteIcon,
  PropertiesPanel,
  Toolbar,
  type CanvasLayout,
  type ThemeChoice,
} from "@penpaper/ui";
import { createElement, type StyleDefaults, type Tool } from "@penpaper/engine";
import type { Element, ElementType } from "@penpaper/shared";
import { useMemo, useState } from "react";

export interface BoardMenuProps {
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
  background: string | null;
  onBackgroundChange: (color: string | null) => void;
  layout: CanvasLayout;
  onLayoutChange: (layout: CanvasLayout) => void;
  onExport: () => void;
  onReset: () => void;
}

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
  /** Style stamped onto the next element the active tool creates. */
  styleDefaults: StyleDefaults;
  onStyleDefaultsChange: (patch: Partial<Element>) => void;
  /** A drawing tool is active, so there is a "next element" to style. */
  isCreating: boolean;
  menu: BoardMenuProps;
}

/**
 * The floating chrome over the canvas.
 *
 * Layout is CSS, not React: the dock and the style panel choose their own side
 * of the breakpoint, so resizing a window never remounts a component and never
 * loses focus in the properties form.
 *
 * The style panel has two jobs, exactly like Excalidraw's: with a drawing tool
 * active it edits the style of the next element, and with a selection it edits
 * that element. The first job is why the panel is visible before a stroke
 * exists at all.
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
  styleDefaults,
  onStyleDefaultsChange,
  isCreating,
  menu,
}: BoardChromeProps) {
  const [stylesOpen, setStylesOpen] = useState(false);

  const showStyle = selection.length > 0 || isCreating;

  // The panel needs an Element because that is the model it edits. For defaults
  // it gets a zero-sized preview of the active tool: same fields, no scene.
  const preview = useMemo(
    () =>
      ({
        ...createElement(
          (isCreating ? tool : "freedraw") as ElementType,
          { x: 0, y: 0, width: 0, height: 0 },
          "style-preview",
        ),
        ...styleDefaults,
      }) as Element,
    [isCreating, styleDefaults, tool],
  );

  const styleValue = selection.length > 0 ? selection : [preview];

  return (
    <>
      <AppMenu
        {...menu}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        trailing={
          <button
            type="button"
            className="pp-menu-button pp-menu-style"
            data-testid="open-styles"
            aria-label="Style"
            aria-haspopup="dialog"
            aria-expanded={stylesOpen}
            onClick={() => setStylesOpen((open) => !open)}
          >
            <PaletteIcon />
          </button>
        }
      />

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

      {showStyle ? (
        <aside className="pp-properties-desktop" aria-label="Style">
          <PropertiesPanel
            selection={styleValue}
            onPatch={selection.length > 0 ? onPatch : onStyleDefaultsChange}
            onDelete={selection.length > 0 ? onDelete : undefined}
            title={selection.length > 0 ? undefined : "Style"}
          />
        </aside>
      ) : null}

      <div className="pp-properties-mobile">
        {stylesOpen ? (
          <BottomSheet label="Style" onClose={() => setStylesOpen(false)}>
            <PropertiesPanel
              selection={styleValue}
              onPatch={selection.length > 0 ? onPatch : onStyleDefaultsChange}
              onDelete={selection.length > 0 ? onDelete : undefined}
              showTitle={false}
            />
          </BottomSheet>
        ) : null}
      </div>
    </>
  );
}
