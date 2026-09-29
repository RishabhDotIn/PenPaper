"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadPreferences, savePreferences } from "@/lib/preferences";
import {
  buildShelf,
  describeCount,
  formatAgo,
  newBoardId,
  seedDemoBoard,
  type ShelfItem,
} from "@/lib/library";
import {
  createBoard,
  listBoards,
  renameBoard,
  TITLE_MAX,
  type BoardMeta,
} from "@/lib/storage";
import { driveConfigured, requestSession, signOut } from "@/lib/drive/auth";
import type { RemoteBoard } from "@/lib/drive/api";
import { useDriveSession } from "@/lib/drive/use-drive-session";
import { describeSync } from "@/lib/drive/status";
import {
  deleteBoardEverywhere,
  listRemoteLibrary,
  publishBoard,
  queueBoardSync,
  syncLibrary,
  unpublishBoard,
} from "@/lib/drive/sync";
import { useSyncStore } from "@/store/sync-store";

/**
 * The shelf.
 *
 * Local-first, exactly like the board: the list comes from IndexedDB and
 * renders before any network call. Drive is an addition, not a gate — a person
 * who never connects still owns every notepad on this device.
 */
export function Library() {
  const router = useRouter();
  const session = useDriveSession();
  const phase = useSyncStore((state) => state.phase);
  const notice = useSyncStore((state) => state.message);
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt);

  const [local, setLocal] = useState<BoardMeta[] | null>(null);
  const [remote, setRemote] = useState<RemoteBoard[]>([]);
  const [autoSync, setAutoSync] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement | null>(null);

  const configured = driveConfigured();
  const connected = Boolean(session);
  const sync = describeSync(connected, phase, lastSyncedAt, notice);

  const items = useMemo(() => buildShelf(local ?? [], remote), [local, remote]);

  const refreshLocal = useCallback(async () => {
    const boards = await listBoards();
    setLocal(boards);
    return boards;
  }, []);

  const refreshRemote = useCallback(async () => {
    const boards = await listRemoteLibrary().catch(() => [] as RemoteBoard[]);
    setRemote(boards);
    return boards;
  }, []);

  useEffect(() => {
    setAutoSync(loadPreferences().autoSync);
  }, []);

  // The shelf is local first. The demo is written once so a new install has
  // something to open, then behaves like any other board.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await seedDemoBoard();
      const boards = await listBoards();
      if (!cancelled) setLocal(boards);
    })().catch(() => {
      if (!cancelled) setLocal([]);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Connecting is the moment the two shelves meet. With auto-sync on, the rest
  // of the device's notepads join without a second decision.
  useEffect(() => {
    if (!session) {
      setRemote([]);
      return;
    }

    let cancelled = false;
    (async () => {
      await refreshRemote();
      if (cancelled) return;

      if (loadPreferences().autoSync) {
        await syncLibrary().catch(() => undefined);
        if (cancelled) return;
        await refreshLocal();
        await refreshRemote();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, refreshLocal, refreshRemote]);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  const connect = useCallback(async () => {
    setBusy("connect");
    setError(null);
    setMessage(null);
    try {
      await requestSession();
      const report = await syncLibrary();
      await refreshLocal();
      await refreshRemote();
      setMessage(
        report.failed > 0
          ? "Connected. Some notepads could not be uploaded yet."
          : report.synced > 0
            ? "Connected. Your notepads are in Drive."
            : "Connected. Choose the notepads you want in Drive.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect to Google Drive");
    } finally {
      setBusy(null);
    }
  }, [refreshLocal, refreshRemote]);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    setError(null);
    try {
      const report = await syncLibrary();
      await refreshLocal();
      await refreshRemote();
      if (report.failed > 0) setError(report.error ?? "Some notepads could not sync");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sync with Drive");
    } finally {
      setBusy(null);
    }
  }, [refreshLocal, refreshRemote]);

  const disconnect = useCallback(() => {
    signOut();
    setRemote([]);
    setMessage("Disconnected. Every notepad stays on this device.");
  }, []);

  const changeAutoSync = useCallback(
    async (next: boolean) => {
      setAutoSync(next);
      savePreferences({ ...loadPreferences(), autoSync: next });

      if (next && connected) {
        setBusy("auto");
        try {
          await syncLibrary();
          await refreshLocal();
          await refreshRemote();
        } catch {
          setError("Auto-sync could not start");
        } finally {
          setBusy(null);
        }
      }
    },
    [connected, refreshLocal, refreshRemote],
  );

  const createNotepad = useCallback(async () => {
    const id = newBoardId();
    const used = new Set((local ?? []).map((board) => board.title));
    let title = "Untitled notepad";
    for (let index = 2; used.has(title); index += 1) title = `Untitled notepad ${index}`;

    try {
      await createBoard(id, { title });
      router.push(`/b/${id}`);
    } catch {
      setError("Could not create a notepad on this device");
    }
  }, [local, router]);

  const commitRename = useCallback(
    async (id: string) => {
      const previous = (local ?? []).find((board) => board.id === id);
      setRenaming(null);
      const next = draft.trim();
      if (!previous || next === previous.title) return;

      try {
        await renameBoard(id, next || previous.title);
        await refreshLocal();
        if (previous.driveFileId) queueBoardSync(id);
      } catch {
        setError("Could not rename that notepad");
      }
    },
    [draft, local, refreshLocal],
  );

  const togglePublish = useCallback(
    async (item: ShelfItem) => {
      setBusy(item.id);
      setError(null);
      try {
        if (item.inLibrary) await unpublishBoard(item.id);
        else await publishBoard(item.id);
        await refreshLocal();
        await refreshRemote();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not change Drive sync");
      } finally {
        setBusy(null);
      }
    },
    [refreshLocal, refreshRemote],
  );

  const remove = useCallback(
    async (item: ShelfItem) => {
      setBusy(item.id);
      try {
        await deleteBoardEverywhere(item.id);
        setConfirmDelete(null);
        await refreshLocal();
        await refreshRemote();
      } catch {
        setError("Could not delete that notepad");
      } finally {
        setBusy(null);
      }
    },
    [refreshLocal, refreshRemote],
  );

  return (
    <main className="lib" data-testid="library">
      <header className="lib-head">
        <div>
          <h1 className="lib-brand">PenPaper</h1>
          <p className="lib-tag">Every notepad, on every device you sign in to.</p>
        </div>

        {session ? (
          <div className="lib-account" data-testid="library-account">
            <AccountAvatar picture={session.account.picture} name={session.account.name} />
            <span className="lib-account-copy">
              <span className="lib-account-name">{session.account.name}</span>
              <span className="lib-account-mail">{session.account.email}</span>
            </span>
            <button type="button" className="lib-link" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="lib-connect"
            data-testid="connect-drive"
            onClick={connect}
            disabled={!configured || busy === "connect"}
          >
            <GoogleMark />
            <span>{busy === "connect" ? "Connecting…" : "Connect Drive"}</span>
          </button>
        )}
      </header>

      <div className="lib-bar">
        <button
          type="button"
          className="lib-primary"
          data-testid="new-notepad"
          onClick={createNotepad}
        >
          <PlusIcon />
          <span>New notepad</span>
        </button>

        {connected ? (
          <div className="lib-sync-bar">
            <label className="lib-switch" data-testid="auto-sync">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(event) => void changeAutoSync(event.target.checked)}
              />
              <span className="lib-switch-track" aria-hidden="true">
                <span className="lib-switch-thumb" />
              </span>
              <span className="lib-switch-label">Auto-sync</span>
            </label>

            <button
              type="button"
              className="lib-ghost"
              onClick={refresh}
              disabled={phase === "syncing" || busy === "refresh"}
            >
              {phase === "syncing" ? "Syncing…" : "Refresh"}
            </button>
          </div>
        ) : null}

        {configured ? (
          <span className="lib-status" data-tone={sync.tone} data-testid="library-status">
            <span className="pp-sync-dot" data-tone={sync.tone} aria-hidden="true" />
            {sync.label}
          </span>
        ) : null}
      </div>

      {!configured ? (
        <p className="lib-hint" data-testid="drive-setup">
          Drive is not configured on this build. Add{" "}
          <code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> to enable it — setup guide:{" "}
          <code>docs/GOOGLE-DRIVE.md</code>
        </p>
      ) : null}

      {connected && !autoSync ? (
        <p className="lib-hint">
          Auto-sync is off. Choose <strong>Sync</strong> on the notepads you want in Google
          Drive; the rest stay on this device.
        </p>
      ) : null}

      {message ? (
        <p className="lib-note" role="status">
          {message}
        </p>
      ) : null}

      {error ? (
        <div className="lib-error" role="alert">
          <span>{error}</span>
          {connected ? (
            <button type="button" className="lib-link" onClick={refresh}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      {local === null ? (
        <ul className="lib-shelf" aria-busy="true">
          {[0, 1, 2].map((key) => (
            <li key={key} className="lib-card lib-card-skeleton" />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="lib-empty" data-testid="library-empty">
          <p className="lib-empty-title">No notepads yet</p>
          <p className="lib-empty-copy">
            Start with a blank page. It is saved on this device the moment you draw.
          </p>
          <button type="button" className="lib-primary" onClick={createNotepad}>
            <PlusIcon />
            <span>New notepad</span>
          </button>
        </div>
      ) : (
        <ul className="lib-shelf">
          {items.map((item) => (
            <li className="lib-card" key={item.id} data-testid={`library-card-${item.id}`}>
              {renaming === item.id ? (
                <form
                  className="lib-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void commitRename(item.id);
                  }}
                >
                  <input
                    ref={renameRef}
                    value={draft}
                    maxLength={TITLE_MAX}
                    aria-label="Notepad name"
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => void commitRename(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setRenaming(null);
                    }}
                  />
                </form>
              ) : (
                <a className="lib-open" href={`/b/${item.id}`}>
                  <span className="lib-title">{item.title}</span>
                  <span className="lib-meta">
                    {describeCount(item.elementCount)} · {formatAgo(item.updatedAt)}
                  </span>
                </a>
              )}

              <div className="lib-side">
                <span
                  className="lib-badge"
                  data-state={item.inLibrary ? "drive" : "local"}
                  title={
                    item.inLibrary
                      ? "In Google Drive"
                      : connected
                        ? "Only on this device"
                        : "Saved on this device"
                  }
                >
                  {item.inLibrary ? <CloudIcon /> : null}
                  {item.inLibrary ? "In Drive" : "On device"}
                </span>

                <div className="lib-actions">
                  {connected && !autoSync ? (
                    <button
                      type="button"
                      className={`lib-chip${item.inLibrary ? "" : " is-primary"}`}
                      onClick={() => void togglePublish(item)}
                      disabled={busy === item.id}
                    >
                      {item.inLibrary ? "Remove from Drive" : "Sync"}
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="lib-icon-button"
                    aria-label={`Rename ${item.title}`}
                    title="Rename"
                    onClick={() => {
                      setDraft(item.title);
                      setRenaming(item.id);
                    }}
                  >
                    <PencilIcon />
                  </button>

                  {confirmDelete === item.id ? (
                    <button
                      type="button"
                      className="lib-chip is-danger"
                      onClick={() => void remove(item)}
                      disabled={busy === item.id}
                    >
                      {item.inLibrary ? "Delete everywhere" : "Delete"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="lib-icon-button"
                      aria-label={`Delete ${item.title}`}
                      title="Delete"
                      onClick={() => {
                        setConfirmDelete(item.id);
                        window.setTimeout(
                          () => setConfirmDelete((current) => (current === item.id ? null : current)),
                          4000,
                        );
                      }}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function AccountAvatar({ picture, name }: { picture: string; name: string }) {
  if (picture) {
    // One request, not a page of them: a remote avatar does not need next/image.
    return <img className="lib-avatar" src={picture} alt="" width={32} height={32} />;
  }
  return (
    <span className="lib-avatar lib-avatar-fallback" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M21.6 12.2c0-.7-.06-1.4-.18-2.05H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.32 2.98-7.37Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.24-2.5c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.6-4.12H3.06v2.58A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.4 13.9a6 6 0 0 1 0-3.81V7.5H3.06a10 10 0 0 0 0 9l3.34-2.6Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.06c1.47 0 2.79.5 3.83 1.5l2.87-2.87A10 10 0 0 0 3.06 7.5l3.34 2.58C7.2 7.82 9.4 6.06 12 6.06Z"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 20h4l10-10-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 7h14" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l.8 12h8.4L17 7" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M7.5 18a4.5 4.5 0 0 1-.4-8.98A5.5 5.5 0 0 1 17.7 9.4 3.8 3.8 0 0 1 17 18H7.5Z" />
    </svg>
  );
}
