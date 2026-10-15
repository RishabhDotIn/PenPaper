"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountPanel } from "@/components/AccountPanel";
import { useAccountStore } from "@/lib/collab/account";
import { driveConfigured, requestSession } from "@/lib/drive/auth";
import { syncLibrary } from "@/lib/drive/sync";
import { useDriveSession } from "@/lib/drive/use-drive-session";
import { describeCount, formatAgo, createNotepad } from "@/lib/library";
import { forgetBoard, loadPreferences, type Preferences } from "@/lib/preferences";
import { loadMeta, listBoards } from "@/lib/storage";
import { useNotepads } from "@/lib/use-notepads";

/**
 * The front door.
 *
 * Opening PenPaper should open the notepad you were last in, the way lifting a
 * notebook off a desk works. Only a device that has never opened one — or whose
 * last notepad was deleted, or was synced from another machine before this one
 * had it — sees the chooser, and the chooser is a card on paper rather than a
 * separate catalogue page.
 */
export function Launcher() {
  const router = useRouter();
  const session = useDriveSession();
  const { items, refreshLocal, refreshRemote, refreshServer } = useNotepads();
  const accountsConfigured = useAccountStore((state) => state.configured);
  const accountPhase = useAccountStore((state) => state.phase);
  const accountUser = useAccountStore((state) => state.user);

  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<"new" | "connect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read in an effect, not during render: the server has no preferences, and a
  // differing `data-paper` attribute on the first client render is a hydration
  // mismatch rather than a preference.
  const [paper, setPaper] = useState<Preferences["layout"]>("lines");

  useEffect(() => {
    setPaper(loadPreferences().layout);
  }, []);

  // Hand off to the remembered notepad before drawing the chooser. A stale id
  // (deleted here, or only known to a connected account) must not strand the
  // person on a board that has no content, so it is verified first.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const last = loadPreferences().lastBoardId;
      if (!last) {
        setChecking(false);
        return;
      }

      const local = await loadMeta(last).catch(() => undefined);
      if (local) {
        router.replace(`/b/${last}`);
        return;
      }

      // Not stored here. The notepad may still be in the account or in Drive,
      // which is exactly the second-device case.
      const localIds = new Set((await listBoards().catch(() => [])).map((board) => board.id));
      const remote = await refreshRemote();
      const server = await refreshServer();
      if (
        !cancelled &&
        (localIds.has(last) ||
          remote.some((board) => board.boardId === last) ||
          server.some((board) => board.id === last))
      ) {
        router.replace(`/b/${last}`);
        return;
      }

      forgetBoard(last);
      if (!cancelled) setChecking(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, refreshRemote, refreshServer]);

  // A connected device shows what Drive has without opening the shelf.
  useEffect(() => {
    if (!session) return;
    void refreshRemote();
  }, [session, refreshRemote]);

  // The token dies with the tab, the account cookie does not. Renew the Drive
  // half quietly so the shelf is complete without asking anyone to sign in
  // again. One attempt: if the grant is gone, the board menu offers Connect.
  const triedSilent = useRef(false);
  useEffect(() => {
    if (accountPhase === "idle" || accountPhase === "loading") return;
    if (session || !driveConfigured() || triedSilent.current) return;
    if (accountsConfigured && !accountUser) return;

    triedSilent.current = true;
    void requestSession({ silent: true }).catch(() => undefined);
  }, [accountPhase, accountsConfigured, accountUser, session]);

  const open = useCallback(
    (id: string) => {
      router.push(`/b/${id}`);
    },
    [router],
  );

  const create = useCallback(async () => {
    setBusy("new");
    setError(null);
    try {
      const id = await createNotepad();
      router.push(`/b/${id}`);
    } catch {
      setError("Could not create a notepad on this device");
      setBusy(null);
    }
  }, [router]);

  const connect = useCallback(async () => {
    setBusy("connect");
    setError(null);
    try {
      await requestSession();
      if (loadPreferences().autoSync) await syncLibrary().catch(() => undefined);
      await refreshLocal();
      await refreshRemote();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect to Google Drive");
    } finally {
      setBusy(null);
    }
  }, [refreshLocal, refreshRemote]);

  if (checking) {
    return (
      <main
        className="launch launch-wait"
        data-paper={paper}
        aria-busy="true"
        data-testid="launcher-wait"
      >
        <p>Opening PenPaper…</p>
      </main>
    );
  }

  const configured = driveConfigured();
  // On a deployment with accounts, signing in is the only door: the same
  // consent connects Drive. The standalone button is only for a deployment
  // with no accounts at all, where Drive is the only identity there is. It
  // waits for the account check so it cannot flash and then vanish.
  const standaloneDrive = configured && !accountsConfigured && accountPhase === "ready";
  const recent = (items ?? []).slice(0, 6);

  return (
    <main
      className="launch"
      data-paper={paper}
      data-testid="launcher"
    >
      <section className="launch-card" aria-labelledby="launch-title">
        <header className="launch-head">
          <h1 id="launch-title" className="launch-brand">
            PenPaper
          </h1>
          <p className="launch-tag">
            Every notepad, on every device you sign in to.
          </p>
        </header>

        {error ? (
          <p className="launch-error" role="alert">
            {error}
          </p>
        ) : null}

        {items === null ? (
          <ul className="launch-list" aria-busy="true">
            {[0, 1].map((key) => (
              <li key={key} className="launch-row launch-row-skeleton" />
            ))}
          </ul>
        ) : recent.length === 0 ? (
          <div className="launch-empty" data-testid="launcher-empty">
            <p className="launch-empty-title">A blank page is waiting</p>
            <p className="launch-empty-copy">
              Start a notepad and it is saved on this device as you draw.
            </p>
          </div>
        ) : (
          <ul className="launch-list" data-testid="launcher-list">
            {recent.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="launch-row"
                  data-testid={`launch-item-${item.id}`}
                  onClick={() => open(item.id)}
                >
                  <span className="launch-row-copy">
                    <span className="launch-row-title">{item.title}</span>
                    <span className="launch-row-meta">
                      {describeCount(item.elementCount)} · {formatAgo(item.updatedAt)}
                      {item.server ? " · Your library" : ""}
                      {item.inLibrary ? " · In Drive" : ""}
                    </span>
                  </span>
                  <ChevronIcon />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="launch-actions">
          <button
            type="button"
            className="launch-primary"
            data-testid="new-notepad"
            onClick={() => void create()}
            disabled={busy !== null}
          >
            <PlusIcon />
            <span>{busy === "new" ? "Creating…" : "New notepad"}</span>
          </button>

          {!session && standaloneDrive ? (
            <button
              type="button"
              className="launch-connect"
              data-testid="connect-drive"
              onClick={() => void connect()}
              disabled={busy !== null}
            >
              <GoogleMark />
              <span>{busy === "connect" ? "Connecting…" : "Connect Drive"}</span>
            </button>
          ) : null}
        </div>

        {!configured ? (
          <p className="launch-hint" data-testid="drive-setup">
            Drive is not configured on this build. PenPaper still saves every notepad on this
            device.
          </p>
        ) : null}

        {/* The chooser is the one screen a new device is guaranteed to see, so
            the account belongs here as well as in the board menu. Signing in
            refreshes both remote shelves in place. */}
        <div className="launch-account-slot">
          <AccountPanel
            variant="launcher"
            onChanged={() => {
              void refreshLocal();
              void refreshRemote();
            }}
          />
        </div>

        <footer className="launch-foot">
          <span className="launch-foot-note">
            {items && items.length > recent.length
              ? `${items.length - recent.length} more in the board menu`
              : "Saved on this device as you draw"}
          </span>
          {session && !accountsConfigured ? (
            <span className="launch-account">
              {session.account.picture ? (
                // eslint-disable-next-line @next/next/no-img-element -- one avatar, no optimizer.
                <img src={session.account.picture} alt="" width={18} height={18} />
              ) : null}
              {session.account.email}
            </span>
          ) : null}
        </footer>
      </section>
    </main>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M9 5l7 7-7 7" />
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

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.06-1.4-.18-2.05H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.32 2.98-7.37Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.24-2.5c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.6-4.12H3.06v2.58A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.81V7.5H3.06a10 10 0 0 0 0 9l3.34-2.6Z" />
      <path fill="#EA4335" d="M12 6.06c1.47 0 2.79.5 3.83 1.5l2.87-2.87A10 10 0 0 0 3.06 7.5l3.34 2.58C7.2 7.82 9.4 6.06 12 6.06Z" />
    </svg>
  );
}
