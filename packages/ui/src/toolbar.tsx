"use client";

import { TOOL_LABELS, TOOL_SHORTCUTS, type Tool } from "@penpaper/engine";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, GeometryIcon, ToolIcon } from "./icons";

/**
 * The geometry shapes, behind one dock button.
 *
 * They used to be three separate icons. Three was already a quarter of the
 * dock, and every shape added later would cost another slot; a menu makes the
 * set extensible without pushing the pen or the eraser off a phone screen.
 */
export const GEOMETRY_TOOLS: readonly Tool[] = [
  "rectangle",
  "diamond",
  "ellipse",
  "triangle",
  "hexagon",
  "star",
];

/** The dock, in order. `"shapes"` stands in for the whole geometry group. */
export const DOCK_SLOTS: readonly (Tool | "shapes")[] = [
  "hand",
  "select",
  "shapes",
  "arrow",
  "line",
  "freedraw",
  "text",
  "laser",
  "eraser",
];

/** Every tool the dock can reach, geometry included. */
export const TOOL_ORDER: readonly Tool[] = [
  "hand",
  "select",
  "rectangle",
  "diamond",
  "ellipse",
  "triangle",
  "hexagon",
  "star",
  "arrow",
  "line",
  "freedraw",
  "text",
  "laser",
  "eraser",
];

const SHORTCUT_FOR: Partial<Record<Tool, string>> = {};
for (const [key, tool] of Object.entries(TOOL_SHORTCUTS)) {
  if (!SHORTCUT_FOR[tool]) SHORTCUT_FOR[tool] = key.toUpperCase();
}

const isGeometry = (tool: Tool): boolean => GEOMETRY_TOOLS.includes(tool);

const DOCK_BREAKPOINT = "(min-width: 1024px)";
const EDGE = 8;
const GAP = 10;

export interface ToolbarProps {
  value: Tool;
  onChange: (tool: Tool) => void;
  className?: string;
}

export function Toolbar({ value, onChange, className }: ToolbarProps): ReactElement {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  // The last shape chosen, so the dock button keeps showing what it will draw
  // after the person switches to the pen and back.
  const [lastShape, setLastShape] = useState<Tool>(
    isGeometry(value) ? value : GEOMETRY_TOOLS[0] ?? "rectangle",
  );

  useEffect(() => {
    if (isGeometry(value)) setLastShape(value);
  }, [value]);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  /**
   * Placed in viewport coordinates through a portal rather than as a child of
   * the dock: below 1024 px the dock scrolls horizontally, and `overflow` on an
   * ancestor would clip a popover growing out of it.
   */
  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!anchor || !panel) return;

      const verticalDock = window.matchMedia(DOCK_BREAKPOINT).matches;
      let left: number;
      let top: number;

      if (verticalDock) {
        // Beside the dock on desktop, centred on the button.
        left = anchor.right + GAP;
        top = anchor.top + anchor.height / 2 - panel.height / 2;
      } else {
        // Above the dock, which is where thumbs and the dock itself leave room.
        left = anchor.left + anchor.width / 2 - panel.width / 2;
        top = anchor.top - panel.height - GAP;
        // A short window cannot drop up; falling below is better than clipping.
        if (top < EDGE) top = anchor.bottom + GAP;
      }

      left = Math.min(Math.max(EDGE, left), window.innerWidth - panel.width - EDGE);
      top = Math.min(Math.max(EDGE, top), window.innerHeight - panel.height - EDGE);
      setPosition({ left, top });
    };

    place();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };

    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  const shapeTool = isGeometry(value) ? value : lastShape;
  const shortcuts = SHORTCUT_FOR;

  const choose = (tool: Tool) => {
    onChange(tool);
    setLastShape(tool);
    close(true);
  };

  return (
    <>
      <div
        className={`pp-dock${className ? ` ${className}` : ""}`}
        data-testid="tool-dock"
        role="toolbar"
        aria-label="Drawing tools"
        aria-orientation="horizontal"
      >
        {DOCK_SLOTS.map((slot) => {
          if (slot === "shapes") {
            const active = isGeometry(value);
            return (
              <button
                key="shapes"
                ref={triggerRef}
                type="button"
                className="pp-tool-button pp-tool-shapes"
                data-testid="tool-shapes"
                data-tool="shapes"
                aria-label={`Shapes (${TOOL_LABELS[shapeTool]})`}
                aria-pressed={active}
                aria-haspopup="true"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
              >
                <GeometryIcon />
                <span className="pp-tool-caret" aria-hidden="true">
                  <ChevronDownIcon />
                </span>
              </button>
            );
          }

          const shortcut = shortcuts[slot];
          const label = TOOL_LABELS[slot];

          return (
            <button
              key={slot}
              type="button"
              className="pp-tool-button"
              data-testid="tool-button"
              data-tool={slot}
              aria-label={label}
              aria-pressed={value === slot}
              title={shortcut ? `${label} (${shortcut})` : label}
              onClick={() => onChange(slot)}
            >
              <ToolIcon tool={slot} />
            </button>
          );
        })}
      </div>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              className="pp-shape-menu"
              role="group"
              aria-label="Shapes"
              data-testid="shape-menu"
              style={{
                left: position?.left ?? -9999,
                top: position?.top ?? -9999,
                visibility: position ? "visible" : "hidden",
              }}
            >
              {GEOMETRY_TOOLS.map((tool) => {
                const shortcut = shortcuts[tool];
                return (
                  <button
                    key={tool}
                    type="button"
                    className="pp-shape-option"
                    data-testid={`shape-${tool}`}
                    data-tool={tool}
                    aria-pressed={value === tool}
                    title={shortcut ? `${TOOL_LABELS[tool]} (${shortcut})` : TOOL_LABELS[tool]}
                    onClick={() => choose(tool)}
                  >
                    <ToolIcon tool={tool} />
                    <span className="pp-shape-name">{TOOL_LABELS[tool]}</span>
                    {shortcut ? <span className="pp-shape-key">{shortcut}</span> : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
