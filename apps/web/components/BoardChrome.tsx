"use client";

import {
  AppMenu,
  PaletteIcon,
  PropertiesPanel,
  StylePopover,
  Toolbar,
  type CanvasLayout,
  type NotepadEntry,
  type ThemeChoice,
} from "@penpaper/ui";
import { createElement, type StyleDefaults, type Tool } from "@penpaper/engine";
import type { Element, ElementType } from "@penpaper/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccountPanel } from "@/components/AccountPanel";
import { LivePanel } from "@/components/LivePanel";
import { useAccountStore } from "@/lib/collab/account";
import type { Role } from "@/lib/collab/api";
import type { CollabPeer } from "@/lib/collab/session";
import { driveConfigured, requestSession } from "@/lib/drive/auth";
import { describeSync } from "@/lib/drive/status";
import {
  deleteBoardEverywhere,
  publishBoard,
  pullBoardById,
  queueBoardSync,
  syncLibrary,
  unpublishBoard,
} from "@/lib/drive/sync";
import { useDriveSession } from "@/lib/drive/use-drive-session";
import { createNotepad, describeCount, formatAgo } from "@/lib/library";
import { loadPreferences } from "@/lib/preferences";
import { loadMeta, renameBoard } from "@/lib/storage";
import { useNotepads } from "@/lib/use-notepads";
import { useSyncStore } from "@/store/sync-store";

export interface BoardMenuProps {
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
  /** Device preference: sync the whole library, or choose per notepad. */
  autoSync: boolean;
  onAutoSyncChange: (autoSync: boolean) => void;
  background: string | null;
  onBackgroundChange: (color: string | null) => void;
  layout: CanvasLayout;
  onLayoutChange: (layout: CanvasLayout) => void;
  onExport: () => void;
  onReset: () => void;
}

export interface BoardChromeProps {
  boardId: string;
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
  /** This caller's role on the server copy, or null for a local-only board. */
  role: Role | null;
  readOnly: boolean;
  liveStatus: "offline" | "connecting" | "online";
  /** Everyone in the room, this tab included. Empty when not live. */
  roster: readonly CollabPeer[];
  /** Host only: show someone out of the room. */
  onRemovePeer?: (id: string) => void;
  onShare: () => void;
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
  boardId,
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
  role,
  readOnly,
  liveStatus,
  roster,
  onRemovePeer,
  onShare,
}: BoardChromeProps) {
  const router = useRouter();
  const accountsConfigured = useAccountStore((state) => state.configured);
  const accountUser = useAccountStore((state) => state.user);
  const accountPhase = useAccountStore((state) => state.phase);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverMounted, setPopoverMounted] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [busy, setBusy] = useState<"connect" | "create" | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const session = useDriveSession();
  const phase = useSyncStore((state) => state.phase);
  const notice = useSyncStore((state) => state.message);
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt);
  const sync = describeSync(Boolean(session), phase, lastSyncedAt, notice);
  const notepads = useNotepads();

  const showStyle = !readOnly && (selection.length > 0 || isCreating);

  // Keep the card mounted for the length of its exit animation; unmounting on
  // the same frame the user taps outside makes it disappear rather than leave.
  useEffect(() => {
    if (popoverOpen) {
      setPopoverMounted(true);
      return;
    }
    if (!popoverMounted) return;
    const timer = window.setTimeout(() => setPopoverMounted(false), 180);
    return () => window.clearTimeout(timer);
  }, [popoverOpen, popoverMounted]);

  // A popover has no backdrop, so anything outside it has to dismiss it: a tap
  // on the canvas, another tool, the menu. Escape does the same for a keyboard.
  useEffect(() => {
    if (!popoverOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-testid="style-popover"], [data-testid="open-styles"]')) return;
      setPopoverOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopoverOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [popoverOpen]);

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

  const entries = useMemo<NotepadEntry[]>(
    () =>
      (notepads.items ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        meta: [describeCount(item.elementCount), formatAgo(item.updatedAt)]
          .filter(Boolean)
          .join(" · "),
        active: item.id === boardId,
        inDrive: item.inLibrary,
        fileId: item.driveFileId,
      })),
    [notepads.items, boardId],
  );

  const openNotepads = useCallback(() => {
    void notepads.refreshLocal();
    void notepads.refreshRemote();
  }, [notepads]);

  const openNotepad = useCallback(
    (id: string) => {
      if (id !== boardId) router.push(`/b/${id}`);
    },
    [boardId, router],
  );

  const startNotepad = useCallback(async () => {
    setBusy("create");
    try {
      const id = await createNotepad();
      router.push(`/b/${id}`);
    } catch {
      setConnectError("Could not create a notepad on this device");
    } finally {
      setBusy(null);
    }
  }, [router]);

  /**
   * Rename from the switcher.
   *
   * A notepad that lives only in Drive has no local card yet, so it is pulled
   * once first; renameBoard works from the card. The next upload renames the
   * file itself, so the two never drift apart.
   */
  const renameNotepad = useCallback(
    async (id: string, title: string) => {
      if (!(await loadMeta(id))) await pullBoardById(id);
      const meta = await renameBoard(id, title);
      if (!meta) throw new Error("Notepad is not available on this device");
      if (meta.driveFileId) queueBoardSync(id);
      await notepads.refreshLocal();
    },
    [notepads],
  );

  const removeNotepad = useCallback(
    async (id: string, fileId?: string) => {
      await deleteBoardEverywhere(id, fileId);
      await notepads.refreshLocal();
      await notepads.refreshRemote();
      // Deleting the notepad you are in leaves the next visit with the chooser,
      // which is clearer than silently opening a different notepad.
      if (id === boardId) router.replace("/");
    },
    [boardId, notepads, router],
  );

  const toggleDriveNotepad = useCallback(
    async (id: string, inDrive: boolean) => {
      if (inDrive) await unpublishBoard(id);
      else await publishBoard(id);
      await notepads.refreshLocal();
      await notepads.refreshRemote();
    },
    [notepads],
  );

  const connect = useCallback(async () => {
    setBusy("connect");
    setConnectError(null);
    try {
      await requestSession();
      if (loadPreferences().autoSync) await syncLibrary().catch(() => undefined);
      await notepads.refreshRemote();
    } catch (cause) {
      setConnectError(cause instanceof Error ? cause.message : "Could not connect to Google Drive");
    } finally {
      setBusy(null);
    }
  }, [notepads]);

  // Google remembers the Drive grant even when this tab does not, so a fresh
  // tab renews it with no popup instead of asking for Connect again. One
  // attempt per session: if the grant is gone, the row keeps its button.
  //
  // While that attempt is in flight the Drive row stays hidden, because a
  // Connect button that vanishes on its own is worse than a row that has not
  // arrived yet. It starts hidden so the first frame after the account check
  // cannot flash one either.
  const silentDrive = useRef(false);
  const [restoringDrive, setRestoringDrive] = useState(true);
  useEffect(() => {
    if (accountsConfigured && !accountUser) {
      // Signing out ends the Drive session; a later sign-in may try again.
      silentDrive.current = false;
      setRestoringDrive(false);
      return;
    }
    // Wait for the account check: without it, a local-only deployment and a
    // signed-out one look the same.
    if (accountPhase === "idle" || accountPhase === "loading") return;
    if (session || !driveConfigured()) {
      setRestoringDrive(false);
      return;
    }
    if (silentDrive.current) return;

    silentDrive.current = true;
    setRestoringDrive(true);
    void requestSession({ silent: true })
      .catch(() => undefined)
      .finally(() => setRestoringDrive(false));
  }, [accountPhase, accountsConfigured, accountUser, session]);

  const configured = driveConfigured();
  // Drive work belongs to a row someone can see: an account above it, or a
  // deployment where Drive is the only identity there is.
  const driveReady = Boolean(session) && (!accountsConfigured || Boolean(accountUser));

  const driveCard = (
    <div className="pp-account">
      {session ? (
        <>
          {/* No action here: the Drive token lives in this tab's session
              storage, so closing the tab is the disconnect. A button would
              only duplicate the account's own Sign out. */}
          <span className="pp-account-avatar pp-account-avatar-fallback" aria-hidden="true">
            <CloudIcon />
          </span>
          <span className="pp-account-copy">
            <span className="pp-account-name">Google Drive</span>
            <span className="pp-account-mail">{session.account.email}</span>
          </span>
        </>
      ) : (
        <>
          <span className="pp-account-avatar pp-account-avatar-fallback" aria-hidden="true">
            <CloudIcon />
          </span>
          <span className="pp-account-copy">
            <span className="pp-account-name">Google Drive</span>
            <span className="pp-account-mail">
              {!configured ? "Drive is not set up here" : "Keep a copy in Drive"}
            </span>
          </span>
          <button
            type="button"
            className="pp-account-action pp-account-connect"
            data-testid="menu-connect-drive"
            onClick={() => void connect()}
            disabled={!configured || busy !== null}
            title={configured ? undefined : "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set in this build"}
          >
            {busy === "connect" ? "Connecting…" : "Connect"}
          </button>
        </>
      )}
      {connectError ? (
        <p className="pp-account-error" role="alert">
          {connectError}
        </p>
      ) : null}
    </div>
  );

  const accountNode = (
    <div className="pp-account-stack">
      <AccountPanel
        variant="menu"
        onChanged={() => {
          void notepads.refreshRemote();
        }}
      />
      {/* One Google consent covers both: the account row signs in and asks for
          Drive in the same popup. A Drive card here would repeat the name and
          address that are already one line above, which reads as a second
          login. It stays for the two cases where it is the only door: a
          deployment with no accounts at all, and an account whose Google grant
          came back without Drive. */}
      {!accountsConfigured || (accountUser && !session && !restoringDrive) ? driveCard : null}
    </div>
  );

  return (
    <>
      <AppMenu
        {...menu}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        autoSync={menu.autoSync}
        onAutoSyncChange={driveReady && !readOnly ? menu.onAutoSyncChange : undefined}
        account={accountNode}
        onShare={accountsConfigured || role ? onShare : undefined}
        readOnly={readOnly}
        onReset={readOnly ? undefined : menu.onReset}
        notepads={entries}
        onOpenNotepad={openNotepad}
        onNewNotepad={() => void startNotepad()}
        // A viewer may open other notepads, but must not rename or delete this
        // one from a link that grants no ownership.
        onRenameNotepad={readOnly ? undefined : renameNotepad}
        onDeleteNotepad={readOnly ? undefined : removeNotepad}
        onToggleDriveNotepad={driveReady && !readOnly ? toggleDriveNotepad : undefined}
        onNotepadsOpen={openNotepads}
        // Only a live connection with an account above it has something to
        // say. Signed out, "Connected to Drive" would describe a row that is
        // not on screen.
        syncNote={
          driveReady ? (
            <>
              <span className="pp-sync-dot" data-tone={sync.tone} aria-hidden="true" />
              <span>{sync.label}</span>
            </>
          ) : undefined
        }
        trailing={
          readOnly ? undefined : (
          <button
            type="button"
            className="pp-menu-button pp-menu-style"
            data-testid="open-styles"
            aria-label="Style"
            aria-haspopup="dialog"
            aria-expanded={popoverOpen}
            onClick={() => setPopoverOpen((open) => !open)}
          >
            <PaletteIcon />
          </button>
          )
        }
      />

      {liveStatus === "offline" ? null : (
        <LivePanel
          status={liveStatus}
          peers={roster}
          canRemove={role === "owner" && !readOnly}
          onRemove={onRemovePeer}
        />
      )}

      {readOnly ? null : (
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
      )}

      {readOnly ? null : <Toolbar value={tool} onChange={onToolChange} />}

      {showStyle ? (
        <div className={`pp-panel-dock${panelOpen ? " is-open" : ""}`}>
          <button
            type="button"
            className="pp-panel-toggle"
            data-testid="toggle-panel"
            aria-label={panelOpen ? "Hide styles" : "Show styles"}
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {panelOpen ? <path d="M9 5l7 7-7 7" /> : <path d="M15 5l-7 7 7 7" />}
            </svg>
          </button>

          <aside
            className="pp-properties-desktop"
            aria-label="Style"
            aria-hidden={!panelOpen}
            inert={!panelOpen}
          >
            <PropertiesPanel
              selection={styleValue}
              onPatch={selection.length > 0 ? onPatch : onStyleDefaultsChange}
              onDelete={selection.length > 0 ? onDelete : undefined}
              title={selection.length > 0 ? undefined : "Style"}
            />
          </aside>
        </div>
      ) : null}

      <div className="pp-properties-mobile">
        {popoverMounted ? (
          <StylePopover label="Style" open={popoverOpen}>
            <PropertiesPanel
              selection={styleValue}
              onPatch={selection.length > 0 ? onPatch : onStyleDefaultsChange}
              onDelete={selection.length > 0 ? onDelete : undefined}
              showTitle={false}
            />
          </StylePopover>
        ) : null}
      </div>
    </>
  );
}

function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M7.5 18a4.5 4.5 0 0 1-.4-8.98A5.5 5.5 0 0 1 17.7 9.4 3.8 3.8 0 0 1 17 18H7.5Z" />
    </svg>
  );
}
