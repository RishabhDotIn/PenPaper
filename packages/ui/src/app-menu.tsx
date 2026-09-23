"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type CanvasLayout = "none" | "dots" | "lines";

export const CANVAS_BACKGROUNDS: ReadonlyArray<{ value: string | null; label: string }> = [
  { value: null, label: "Theme default" },
  { value: "#ffffff", label: "White paper" },
  { value: "#fff9db", label: "Cream paper" },
  { value: "#e7f5ff", label: "Blue paper" },
  { value: "#ebfbee", label: "Green paper" },
  { value: "#f3f0ff", label: "Lavender paper" },
];

const THEMES: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const LAYOUTS: ReadonlyArray<{ value: CanvasLayout; label: string; hint: string }> = [
  { value: "none", label: "Plain", hint: "Blank paper" },
  { value: "dots", label: "Dotted", hint: "Dots at every grid intersection" },
  { value: "lines", label: "Box", hint: "Graph paper" },
];

export interface AppMenuProps {
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
  background: string | null;
  onBackgroundChange: (color: string | null) => void;
  layout: CanvasLayout;
  onLayoutChange: (layout: CanvasLayout) => void;
  onExport: () => void;
  onReset: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * The hamburger: everything that is not a drawing tool.
 *
 * It is a popover rather than a full menu bar because the board is the page —
 * nothing may permanently steal canvas area. Actions that change appearance
 * keep it open so a person can compare themes or papers; destructive and
 * one-shot actions close it.
 */
export function AppMenu({
  theme,
  onThemeChange,
  background,
  onBackgroundChange,
  layout,
  onLayoutChange,
  onExport,
  onReset,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: AppMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // A destructive action should not stay armed forever if the menu is left
  // open and the person walks away.
  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  const close = () => {
    setOpen(false);
    setConfirmReset(false);
  };

  return (
    <div className="pp-menu-root" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="pp-menu-button"
        data-testid="app-menu-button"
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setConfirmReset(false);
        }}
      >
        <HamburgerIcon />
      </button>

      {open ? (
        <div
          className="pp-menu"
          role="dialog"
          aria-label="Board menu"
          data-testid="app-menu"
        >
          <button
            type="button"
            className="pp-menu-item"
            disabled={!canUndo}
            onClick={() => {
              onUndo();
              close();
            }}
          >
            <UndoIcon />
            <span>Undo</span>
            <kbd>Ctrl Z</kbd>
          </button>
          <button
            type="button"
            className="pp-menu-item"
            disabled={!canRedo}
            onClick={() => {
              onRedo();
              close();
            }}
          >
            <RedoIcon />
            <span>Redo</span>
            <kbd>Ctrl Shift Z</kbd>
          </button>

          <div className="pp-menu-sep" />

          <div className="pp-menu-section">
            <span className="pp-menu-label">Theme</span>
            <div className="pp-menu-segment" role="group" aria-label="Theme">
              {THEMES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={theme === option.value}
                  onClick={() => onThemeChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pp-menu-section">
            <span className="pp-menu-label">Canvas background</span>
            <div className="pp-menu-swatches" role="group" aria-label="Canvas background">
              {CANVAS_BACKGROUNDS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={`pp-menu-swatch${option.value === null ? " pp-menu-swatch-theme" : ""}`}
                  style={option.value ? { background: option.value } : undefined}
                  aria-label={option.label}
                  aria-pressed={background === option.value}
                  onClick={() => onBackgroundChange(option.value)}
                />
              ))}
            </div>
          </div>

          <div className="pp-menu-section">
            <span className="pp-menu-label">Canvas layout</span>
            <div className="pp-menu-segment" role="group" aria-label="Canvas layout">
              {LAYOUTS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.hint}
                  aria-pressed={layout === option.value}
                  onClick={() => onLayoutChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pp-menu-sep" />

          <button
            type="button"
            className="pp-menu-item"
            onClick={() => {
              onExport();
              close();
            }}
          >
            <DownloadIcon />
            <span>Export PNG</span>
          </button>

          <button
            type="button"
            className="pp-menu-item pp-menu-danger"
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              onReset();
              close();
            }}
          >
            <TrashIcon />
            <span>{confirmReset ? "Tap again to clear" : "Reset canvas"}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function HamburgerIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M4 6.5h16" />
      <path d="M4 12h16" />
      <path d="M4 17.5h16" />
    </svg>
  );
}

function UndoIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M9 7 4.5 11.5 9 16" />
      <path d="M4.5 11.5H15a4.5 4.5 0 0 1 0 9h-2" />
    </svg>
  );
}

function RedoIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M15 7l4.5 4.5L15 16" />
      <path d="M19.5 11.5H9a4.5 4.5 0 0 0 0 9h2" />
    </svg>
  );
}

function DownloadIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 4v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function TrashIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 7h14" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l.8 12h8.4L17 7" />
    </svg>
  );
}
