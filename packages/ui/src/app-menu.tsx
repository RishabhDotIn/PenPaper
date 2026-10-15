"use client";

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

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

/** Null is "follow the theme"; it renders as a chip, not a split circle. */
const PAPER_BACKGROUNDS = CANVAS_BACKGROUNDS.filter((option) => option.value !== null);

/** One row in the in-menu notepad list. */
export interface NotepadEntry {
  id: string;
  title: string;
  /** "12 shapes · 3m ago", already formatted by the caller. */
  meta?: string;
  active?: boolean;
  inDrive?: boolean;
  /** Drive file id, so a remote-only notepad can be deleted without opening it. */
  fileId?: string;
}

export interface AppMenuProps {
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
  background: string | null;
  onBackgroundChange: (color: string | null) => void;
  layout: CanvasLayout;
  onLayoutChange: (layout: CanvasLayout) => void;
  onExport: () => void;
  onReset?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Identity and Drive state, pinned above the notepad list. */
  /** Opens the share card. Omitted when this deployment has no accounts. */
  onShare?: () => void;
  /** A guest through a share link can watch but not edit. */
  readOnly?: boolean;
  account?: ReactNode;
  /**
   * The device's notepads, rendered as a second view inside the same popover.
   * Switching, renaming, and deleting all happen here: there is no separate
   * management page, because day-to-day housekeeping should not cost a
   * navigation away from the canvas.
   */
  notepads?: readonly NotepadEntry[];
  onOpenNotepad?: (id: string) => void;
  onNewNotepad?: () => void;
  /** Renames a notepad on this device (and its Drive file on the next upload). */
  onRenameNotepad?: (id: string, title: string) => Promise<void> | void;
  /** Deletes a notepad here and, when it has a file, in Drive. */
  onDeleteNotepad?: (id: string, fileId?: string) => Promise<void> | void;
  /** When false, each row carries its own Sync / Remove from Drive action. */
  autoSync?: boolean;
  onAutoSyncChange?: (value: boolean) => void;
  /** Turns Drive on or off for one notepad while auto-sync is off. */
  onToggleDriveNotepad?: (id: string, inDrive: boolean) => Promise<void> | void;
  /** Called when the notepad view opens, for a lazy Drive refresh. */
  onNotepadsOpen?: () => void;
  /** One line about Drive, under the shelf item. */
  syncNote?: ReactNode;
  /**
   * Another action rendered inside the same island, e.g. the style trigger on
   * touch widths. Keeping it here means the left edge is one island, not two.
   */
  trailing?: ReactNode;
}

/**
 * The hamburger: everything that is not a drawing tool.
 *
 * It is a popover rather than a full menu bar because the board is the page —
 * nothing may permanently steal canvas area. Actions that change appearance
 * keep it open so a person can compare themes or papers; destructive and
 * one-shot actions close it.
 *
 * The notepad list is a view inside this popover rather than a route: the
 * canvas, its undo history, and the camera all survive a switch to another
 * notepad only if the app does the switching, not the router.
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
  account,
  onShare,
  readOnly,
  notepads,
  onOpenNotepad,
  onNewNotepad,
  onRenameNotepad,
  onDeleteNotepad,
  autoSync,
  onAutoSyncChange,
  onToggleDriveNotepad,
  onNotepadsOpen,
  syncNote,
  trailing,
}: AppMenuProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<"root" | "notepads">("root");
  const [confirmReset, setConfirmReset] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const committingRef = useRef(false);

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

  // Keep the panel in the DOM for the length of its departure, so closing is a
  // material leaving the screen rather than a node vanishing between frames.
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const timer = window.setTimeout(() => setMounted(false), 180);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  // A destructive action should not stay armed forever if the menu is left
  // open and the person walks away.
  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  // Same for a notepad delete: armed per row, disarmed on its own.
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(null), 4000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  // Reset after the exit animation, not when the close begins: switching the
  // visible view mid-departure reads as a flicker, not as the menu leaving.
  useEffect(() => {
    if (mounted) return;
    setView("root");
    setRenamingId(null);
    setConfirmDelete(null);
    setRowError(null);
  }, [mounted]);

  // A view swap removes the button that was focused. Send focus to the new
  // view's first control so a keyboard user is not dropped on <body>.
  useEffect(() => {
    if (open && view === "notepads") backRef.current?.focus();
  }, [open, view]);

  const close = () => {
    setOpen(false);
    setConfirmReset(false);
    setRenamingId(null);
    setConfirmDelete(null);
    setRowError(null);
  };

  const openNotepads = () => {
    setView("notepads");
    setRowError(null);
    onNotepadsOpen?.();
  };

  const startRename = (notepad: NotepadEntry) => {
    setRenamingId(notepad.id);
    setDraft(notepad.title);
    setConfirmDelete(null);
    setRowError(null);
  };

  const commitRename = async (notepad: NotepadEntry) => {
    if (committingRef.current) return;
    committingRef.current = true;
    const next = draft.trim();
    setRenamingId(null);

    if (next && next !== notepad.title) {
      try {
        await onRenameNotepad?.(notepad.id, next);
      } catch {
        setRowError("Could not rename that notepad");
      }
    }

    committingRef.current = false;
  };

  const remove = async (notepad: NotepadEntry) => {
    setBusyId(notepad.id);
    setRowError(null);
    try {
      await onDeleteNotepad?.(notepad.id, notepad.fileId);
      setConfirmDelete(null);
    } catch {
      setRowError("Could not delete that notepad");
    } finally {
      setBusyId(null);
    }
  };

  const toggleDrive = async (notepad: NotepadEntry) => {
    setBusyId(notepad.id);
    setRowError(null);
    try {
      await onToggleDriveNotepad?.(notepad.id, Boolean(notepad.inDrive));
    } catch {
      setRowError(
        notepad.inDrive ? "Could not remove it from Drive" : "Could not sync it to Drive",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="pp-menu-root" ref={rootRef}>
      <div className="pp-menu-island">
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

        {trailing}
      </div>

      {open || mounted ? (
        <div
          className="pp-menu"
          role="dialog"
          aria-label="Board menu"
          data-testid="app-menu"
          data-view={view}
          data-state={open ? "open" : "closed"}
          aria-hidden={!open}
          inert={!open}
        >
          {view === "notepads" ? (
            <div className="pp-menu-view" data-testid="app-menu-notepads">
              <div className="pp-menu-head">
                <button
                  ref={backRef}
                  type="button"
                  className="pp-menu-back"
                  aria-label="Back"
                  onClick={() => setView("root")}
                >
                  <ChevronLeftIcon />
                </button>
                <span className="pp-menu-heading">All notepads</span>
              </div>

              <div className="pp-notepads" role="group" aria-label="Notepads">
                {notepads && notepads.length > 0 ? (
                  notepads.map((notepad) =>
                    renamingId === notepad.id ? (
                      <div key={notepad.id} className="pp-notepad-row is-editing">
                        <input
                          className="pp-notepad-input"
                          value={draft}
                          maxLength={80}
                          aria-label={`Rename ${notepad.title}`}
                          autoFocus
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => setDraft(event.target.value)}
                          onBlur={() => void commitRename(notepad)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                            if (event.key === "Escape") {
                              committingRef.current = true;
                              setRenamingId(null);
                              committingRef.current = false;
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        key={notepad.id}
                        className="pp-notepad-row"
                        data-current={notepad.active ? "true" : undefined}
                      >
                        <button
                          type="button"
                          className="pp-notepad"
                          data-testid={`menu-notepad-${notepad.id}`}
                          aria-current={notepad.active ? "true" : undefined}
                          onClick={() => {
                            onOpenNotepad?.(notepad.id);
                            close();
                          }}
                        >
                          <span className="pp-notepad-title">
                            {notepad.title}
                            {notepad.inDrive ? (
                              <span className="pp-notepad-cloud" aria-label="In Drive" title="In Drive">
                                <CloudSmallIcon />
                              </span>
                            ) : null}
                          </span>
                          {notepad.meta ? (
                            <span className="pp-notepad-meta">{notepad.meta}</span>
                          ) : null}
                        </button>

                        {onRenameNotepad || onDeleteNotepad ? (
                          <div className="pp-notepad-actions">
                            {autoSync === false && onToggleDriveNotepad ? (
                              <button
                                type="button"
                                className="pp-notepad-action"
                                data-testid={`drive-notepad-${notepad.id}`}
                                aria-label={
                                  notepad.inDrive
                                    ? `Remove ${notepad.title} from Drive`
                                    : `Sync ${notepad.title} to Drive`
                                }
                                aria-pressed={Boolean(notepad.inDrive)}
                                title={notepad.inDrive ? "Remove from Drive" : "Sync to Drive"}
                                disabled={busyId !== null}
                                onClick={() => void toggleDrive(notepad)}
                              >
                                {notepad.inDrive ? <CloudSmallIcon /> : <CloudOffIcon />}
                              </button>
                            ) : null}

                            {onRenameNotepad ? (
                              <button
                                type="button"
                                className="pp-notepad-action"
                                data-testid={`rename-notepad-${notepad.id}`}
                                aria-label={`Rename ${notepad.title}`}
                                title="Rename"
                                disabled={busyId !== null}
                                onClick={() => startRename(notepad)}
                              >
                                <PencilIcon />
                              </button>
                            ) : null}

                            {confirmDelete === notepad.id ? (
                              <button
                                type="button"
                                className="pp-notepad-action pp-notepad-confirm"
                                data-testid={`confirm-delete-${notepad.id}`}
                                aria-label={`Confirm delete ${notepad.title}`}
                                disabled={busyId !== null}
                                onClick={() => void remove(notepad)}
                              >
                                {busyId === notepad.id ? "…" : "Delete"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="pp-notepad-action"
                                data-testid={`delete-notepad-${notepad.id}`}
                                aria-label={`Delete ${notepad.title}`}
                                title={notepad.inDrive ? "Delete here and in Drive" : "Delete"}
                                disabled={busyId !== null}
                                onClick={() => {
                                  setConfirmDelete(notepad.id);
                                  setRenamingId(null);
                                }}
                              >
                                <TrashIcon />
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ),
                  )
                ) : (
                  <p className="pp-menu-empty">No notepads on this device yet.</p>
                )}
              </div>

              {rowError ? (
                <p className="pp-notepad-error" role="alert">
                  {rowError}
                </p>
              ) : null}

              <div className="pp-menu-sep" />

              <button
                type="button"
                className="pp-menu-item"
                data-testid="menu-new-notepad"
                onClick={() => {
                  onNewNotepad?.();
                  close();
                }}
              >
                <PlusIcon />
                <span>New notepad</span>
              </button>
            </div>
          ) : (
            <div className="pp-menu-view">
              {account ? <div className="pp-menu-account">{account}</div> : null}

              {notepads ? (
                <button
                  type="button"
                  className="pp-menu-item"
                  data-testid="open-notepads"
                  onClick={openNotepads}
                >
                  <ShelfIcon />
                  <span>All notepads</span>
                  <span className="pp-menu-count">{notepads.length}</span>
                </button>
              ) : null}

              {onShare ? (
                <button
                  type="button"
                  className="pp-menu-item"
                  data-testid="open-share"
                  onClick={() => {
                    onShare();
                    close();
                  }}
                >
                  <ShareIcon />
                  <span>Share</span>
                  {readOnly ? <span className="pp-menu-count">View</span> : null}
                </button>
              ) : null}

              {syncNote ? <p className="pp-menu-note">{syncNote}</p> : null}

              {onAutoSyncChange ? (
                <div className="pp-menu-section">
                  <span className="pp-menu-label">Drive sync</span>
                  <div className="pp-menu-segment" role="group" aria-label="Drive sync">
                    <button
                      type="button"
                      data-testid="auto-sync-on"
                      aria-pressed={autoSync !== false}
                      onClick={() => onAutoSyncChange(true)}
                    >
                      All notepads
                    </button>
                    <button
                      type="button"
                      data-testid="auto-sync-off"
                      aria-pressed={autoSync === false}
                      onClick={() => onAutoSyncChange(false)}
                    >
                      Choose
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="pp-menu-sep" />

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
                  <button
                    type="button"
                    className="pp-menu-auto"
                    aria-label="Theme default"
                    aria-pressed={background === null}
                    onClick={() => onBackgroundChange(null)}
                  >
                    Auto
                  </button>
                  {PAPER_BACKGROUNDS.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      className="pp-menu-swatch"
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

              {onReset ? (
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
              ) : null}
            </div>
          )}
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

function ChevronLeftIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M15 5l-7 7 7 7" />
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

function ShelfIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4.5 5.5h6v13h-6z" />
      <path d="M13.5 5.5h6v13h-6z" />
      <path d="M7.5 9.5h0.01" />
      <path d="M7.5 13h0.01" />
    </svg>
  );
}

function ShareIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="17.5" cy="6" r="2.5" />
      <circle cx="6.5" cy="12" r="2.5" />
      <circle cx="17.5" cy="18" r="2.5" />
      <path d="m8.8 10.8 6.4-3.5M8.8 13.2l6.4 3.5" />
    </svg>
  );
}

function PlusIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
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

function CloudSmallIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M7.5 18a4.5 4.5 0 0 1-.4-8.98A5.5 5.5 0 0 1 17.7 9.4 3.8 3.8 0 0 1 17 18H7.5Z" />
    </svg>
  );
}

function CloudOffIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M7.5 18a4.5 4.5 0 0 1-.4-8.98A5.5 5.5 0 0 1 17.7 9.4 3.8 3.8 0 0 1 17 18H7.5Z" />
      <path d="m4 4 16 16" />
    </svg>
  );
}

function PencilIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4.5 19.5h3l9.7-9.7a2.1 2.1 0 0 0-3-3L4.5 16.5v3Z" />
      <path d="m13.5 7.5 3 3" />
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
