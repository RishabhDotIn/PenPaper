"use client";

import type { Element } from "@penpaper/shared";
import {
  deleteBoard,
  listBoards,
  loadBoard,
  loadMeta,
  saveBoard,
  updateMeta,
  defaultTitle,
  type BoardMeta,
  type BoardSnapshot,
} from "@/lib/storage";
import { forgetBoard, loadPreferences } from "@/lib/preferences";
import { useSyncStore } from "@/store/sync-store";
import { DriveAuthError, driveConfigured, ensureSession, hasSession, requestSession } from "./auth";
import {
  downloadBoard,
  findRemoteBoard,
  listRemoteBoards,
  statRemoteBoard,
  trashBoard,
  uploadBoard,
  type RemoteBoard,
} from "./api";
import { mergeChanges, mergeElements, type DriveBoardDocument } from "./document";

/** A save can arrive in bursts; this is long enough to upload one stroke, not ten. */
const PUSH_DEBOUNCE_MS = 1200;

/**
 * Drive file ids whose local board was deleted while disconnected.
 *
 * Deleting only locally would let the next sync download the file back, which
 * looks like a resurrection. The id is tiny and device-local, so it is kept in
 * `localStorage` until a connected sync can trash the file.
 */
const PENDING_DELETES_KEY = "penpaper:drive:pending-deletes:v1";

function readPendingDeletes(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_DELETES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writePendingDeletes(ids: string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(PENDING_DELETES_KEY);
    else localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable: the delete still happened locally.
  }
}

function rememberPendingDelete(fileId: string): void {
  const pending = readPendingDeletes();
  if (!pending.includes(fileId)) writePendingDeletes([...pending, fileId]);
}

/** Already gone is as good as trashed. */
function isGone(error: unknown): boolean {
  return (
    error instanceof Error &&
    "status" in error &&
    (error.status === 404 || error.status === 410)
  );
}

/** Runs before a library sync so an offline delete is not undone by a pull. */
async function flushPendingDeletes(): Promise<void> {
  const pending = readPendingDeletes();
  if (pending.length === 0) return;

  const left: string[] = [];
  for (const fileId of pending) {
    try {
      await trashBoard(fileId);
    } catch (error) {
      if (!isGone(error)) left.push(fileId);
    }
  }
  writePendingDeletes(left);
}

/** Trash now, or remember to trash when the device is next connected. */
async function trashOrRemember(fileId: string): Promise<void> {
  if (!hasSession()) {
    rememberPendingDelete(fileId);
    return;
  }

  try {
    await trashBoard(fileId);
  } catch (error) {
    if (!isGone(error)) rememberPendingDelete(fileId);
  }
}

const inFlight = new Map<string, Promise<ReconcileResult>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export interface ReconcileResult {
  /** Set when the remote copy contributed elements the open canvas must adopt. */
  merged: Element[] | null;
  remote: RemoteBoard | null;
  syncedAt: number | null;
}

export interface SyncReport {
  synced: number;
  failed: number;
  skipped: number;
  /** First failure message, for the shelf's status line. */
  error: string | null;
}

const EMPTY: ReconcileResult = { merged: null, remote: null, syncedAt: null };

function documentFor(boardId: string, title: string, snapshot: BoardSnapshot): DriveBoardDocument {
  return {
    format: "penpaper.board",
    version: 1,
    boardId,
    title,
    savedAt: snapshot.savedAt,
    elements: snapshot.elements,
  };
}

function isEnabled(meta: BoardMeta | null): boolean {
  if (loadPreferences().autoSync) return true;
  return meta?.inLibrary === true || Boolean(meta?.driveFileId);
}

/**
 * Makes sure a board has a shelf card before Drive bookkeeping is written.
 *
 * Boards from a pre-v2 build have a scene but no metadata. Writing the card
 * here means a first upload can record its file id instead of re-uploading a
 * duplicate on every open.
 */
async function ensureMeta(boardId: string): Promise<BoardMeta | null> {
  const existing = await loadMeta(boardId);
  if (existing) return existing;

  const snapshot = await loadBoard(boardId);
  if (!snapshot) return null;

  await saveBoard(boardId, snapshot);
  return loadMeta(boardId);
}

/**
 * Brings one board and its Drive file back into agreement.
 *
 * Order matters: pull and merge first, then write the merged scene locally,
 * then upload. Uploading the local copy before looking would silently overwrite
 * whatever the other device wrote, which is exactly the lost-work case a sync
 * feature exists to prevent.
 */
export async function reconcileBoard(boardId: string): Promise<ReconcileResult> {
  if (!driveConfigured() || !hasSession()) return EMPTY;

  const running = inFlight.get(boardId);
  if (running) return running;

  const task = (async (): Promise<ReconcileResult> => {
    const snapshot = await loadBoard(boardId);
    if (!snapshot) return EMPTY;

    const meta = await ensureMeta(boardId);
    // Auto-sync off and this notepad was not chosen: opening it must not upload
    // it. This is the single gate for the debounced, open-time, and library
    // paths.
    if (!isEnabled(meta)) return EMPTY;

    const title = meta?.title ?? defaultTitle(boardId);

    let remote: RemoteBoard | null = null;
    const knownFileId = meta?.driveFileId;
    if (knownFileId) {
      remote = await statRemoteBoard(knownFileId).catch((error: unknown) => {
        // A file the user deleted in Drive is not an error: the next upload
        // recreates it in the folder.
        if (error instanceof Error && "status" in error && error.status === 404) return null;
        throw error;
      });

      if (!remote) {
        // Drop the dead link before uploading. `uploadBoard` treats a file id
        // as "update this file"; a trashed id would fail forever.
        await updateMeta(boardId, { driveFileId: undefined, driveVersion: undefined });
      }
    } else {
      remote = await findRemoteBoard(boardId);
    }

    let elements = snapshot.elements;
    let adopted = false;

    if (remote && meta?.driveVersion !== remote.version) {
      const document = await downloadBoard(remote.fileId);
      const merged = mergeElements(elements, document.elements);
      if (mergeChanges(elements, merged)) {
        elements = merged;
        adopted = true;
      }
    }

    if (adopted) {
      await saveBoard(boardId, { ...snapshot, elements, savedAt: Date.now() });
    }

    const after = await loadMeta(boardId);
    const dirty = (after?.updatedAt ?? 0) > (after?.syncedAt ?? 0);
    const needsUpload = !remote || adopted || dirty;

    if (needsUpload) {
      remote = await uploadBoard({
        fileId: remote?.fileId ?? after?.driveFileId,
        title: after?.title ?? title,
        document: documentFor(boardId, after?.title ?? title, { ...snapshot, elements }),
      });
    }

    const syncedAt = Date.now();
    await updateMeta(boardId, {
      driveFileId: remote?.fileId,
      driveVersion: remote?.version,
      syncedAt,
      // With auto-sync off, a board that has been published stays published.
      ...(loadPreferences().autoSync ? {} : { inLibrary: true }),
    });

    return { merged: adopted ? elements : null, remote, syncedAt };
  })();

  inFlight.set(boardId, task);
  try {
    return await task;
  } finally {
    inFlight.delete(boardId);
  }
}

/**
 * Every board that belongs to the library, one at a time.
 *
 * Sequential rather than parallel: a shelf of twelve notepads would otherwise
 * open twelve uploads at once and hit Drive's per-user rate limit.
 */
export async function syncLibrary(): Promise<SyncReport> {
  const store = useSyncStore.getState();
  const report: SyncReport = { synced: 0, failed: 0, skipped: 0, error: null };

  if (!driveConfigured() || !hasSession()) return report;

  store.setPhase("syncing");

  // An offline deletion first: pulling those files back would undo it.
  await flushPendingDeletes();

  const boards = await listBoards();
  for (const meta of boards) {
    if (!isEnabled(meta)) {
      report.skipped += 1;
      continue;
    }

    try {
      const result = await reconcileBoard(meta.id);
      if (result.syncedAt) {
        report.synced += 1;
        store.markSynced(result.syncedAt);
      }
    } catch (error) {
      report.failed += 1;
      report.error ??= error instanceof Error ? error.message : "Sync failed";
    }
  }

  if (report.failed > 0) {
    store.setPhase("error", report.error);
  } else {
    store.setPhase("idle");
  }

  return report;
}

/**
 * The auto-save path: local first, Drive a beat later.
 *
 * Nothing here may throw into the canvas. A failed push leaves the board on the
 * device and marks the shelf so the person can retry when they are back online.
 */
export function queueBoardSync(boardId: string): void {
  if (!driveConfigured() || !hasSession()) return;

  const timer = timers.get(boardId);
  if (timer) clearTimeout(timer);

  timers.set(
    boardId,
    setTimeout(() => {
      timers.delete(boardId);
      void (async () => {
        try {
          const meta = await loadMeta(boardId);
          if (!isEnabled(meta)) return;
          const result = await reconcileBoard(boardId);
          if (result.syncedAt) useSyncStore.getState().markSynced(result.syncedAt);
        } catch (error) {
          useSyncStore
            .getState()
            .setPhase("error", error instanceof Error ? error.message : "Sync failed");
        }
      })();
    }, PUSH_DEBOUNCE_MS),
  );
}

/** Fire every queued push now (tab hiding, reconnect, explicit refresh). */
export async function flushSyncQueue(): Promise<void> {
  const ids = [...timers.keys()];
  for (const id of ids) {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
  }

  for (const id of ids) {
    await reconcileBoard(id).catch(() => undefined);
  }
}

/**
 * Loads a board that exists in Drive but not on this device.
 *
 * This is what makes a shelf work across machines: the board's id comes from
 * the URL, the *file's* id does not, so the lookup goes through the app-private
 * property rather than a remembered mapping.
 */
export async function pullBoardById(boardId: string): Promise<BoardSnapshot | null> {
  if (!driveConfigured() || !hasSession()) return null;

  const remote = await findRemoteBoard(boardId);
  if (!remote) return null;

  // The board was deleted on another visit; do not resurrect it from Drive.
  if (readPendingDeletes().includes(remote.fileId)) return null;

  const document = await downloadBoard(remote.fileId);
  const existing = await loadBoard(boardId);
  const elements = mergeElements(existing?.elements ?? [], document.elements);

  const snapshot: BoardSnapshot = {
    version: existing?.version ?? 1,
    elements,
    camera: existing?.camera ?? { x: 0, y: 0, zoom: 1 },
    savedAt: Date.now(),
  };

  await saveBoard(boardId, snapshot);
  await updateMeta(boardId, {
    title: document.title ?? remote.title,
    driveFileId: remote.fileId,
    driveVersion: remote.version,
    syncedAt: Date.now(),
  });

  return snapshot;
}

/**
 * The explicit button: connect if needed, publish this board, keep the rest
 * alone unless auto-sync says otherwise.
 */
export async function publishBoard(boardId: string): Promise<ReconcileResult> {
  if (!driveConfigured()) {
    throw new DriveAuthError("Google Drive is not configured", "no-client-id");
  }

  await ensureSession();
  await ensureMeta(boardId);
  await updateMeta(boardId, { inLibrary: true });

  const result = await reconcileBoard(boardId);
  if (result.syncedAt) useSyncStore.getState().markSynced(result.syncedAt);
  return result;
}

/** Takes one board out of the library. The local copy stays. */
export async function unpublishBoard(boardId: string): Promise<void> {
  const meta = await loadMeta(boardId);

  if (meta?.driveFileId) await trashOrRemember(meta.driveFileId);

  await updateMeta(boardId, {
    driveFileId: undefined,
    driveVersion: undefined,
    syncedAt: undefined,
    inLibrary: false,
  });
}

/**
 * Deletes a board here and, when it belongs to the library, in Drive too.
 *
 * `driveFileId` covers a notepad that only exists in Drive: the menu can list
 * and delete it without ever opening it, so no local card carries the file id.
 */
export async function deleteBoardEverywhere(
  boardId: string,
  driveFileId?: string,
): Promise<void> {
  const meta = await loadMeta(boardId);
  const fileId = meta?.driveFileId ?? driveFileId;
  if (fileId) await trashOrRemember(fileId);
  await deleteBoard(boardId);
  // `/` must not try to reopen a notepad that no longer exists.
  forgetBoard(boardId);
}

const LIBRARY_SWEEP_KEY = "penpaper:library-sweep:v1";
const LIBRARY_SWEEP_EVERY_MS = 5 * 60_000;

/**
 * A quiet library-wide sweep for the board route.
 *
 * Opening a notepad reconciles that notepad; the rest of the library would
 * otherwise wait for a visit to the shelf. Five minutes per tab is often enough
 * to pick up work started on another device without spending the session's
 * first seconds on uploads.
 */
export function syncLibraryInBackground(): void {
  if (!driveConfigured() || !hasSession() || !loadPreferences().autoSync) return;

  try {
    const last = Number(sessionStorage.getItem(LIBRARY_SWEEP_KEY) ?? 0);
    if (Date.now() - last < LIBRARY_SWEEP_EVERY_MS) return;
    sessionStorage.setItem(LIBRARY_SWEEP_KEY, String(Date.now()));
  } catch {
    // Storage blocked: sweep anyway, it is one pass over the library.
  }

  void syncLibrary().catch(() => undefined);
}

/** The remote shelf, for boards this device has never opened. */
export async function listRemoteLibrary(): Promise<RemoteBoard[]> {
  if (!driveConfigured() || !hasSession()) return [];
  return listRemoteBoards();
}

/** Reconnect from a click, then bring the whole shelf up to date. */
export async function reconnectAndSync(): Promise<SyncReport> {
  await requestSession();
  return syncLibrary();
}
