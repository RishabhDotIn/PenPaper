"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccountStore } from "@/lib/collab/account";
import type { BoardSummary } from "@/lib/collab/api";
import { listServerLibrary } from "@/lib/collab/board-sync";
import type { RemoteBoard } from "@/lib/drive/api";
import { listRemoteLibrary } from "@/lib/drive/sync";
import { useDriveSession } from "@/lib/drive/use-drive-session";
import { buildShelf, seedDemoBoard, type ShelfItem } from "@/lib/library";
import { listBoards, type BoardMeta } from "@/lib/storage";

export interface NotepadsHandle {
  /** Null while the first IndexedDB read is still in flight. */
  items: ShelfItem[] | null;
  local: BoardMeta[];
  server: BoardSummary[];
  refreshLocal: () => Promise<BoardMeta[]>;
  /** Fetches Drive's and the account's copies of the list. Cheap when signed out. */
  refreshRemote: () => Promise<RemoteBoard[]>;
  refreshServer: () => Promise<BoardSummary[]>;
}

/**
 * The device's notepads, plus Drive's and the account's when connected.
 *
 * Local first, always: the menu and the launcher must render from IndexedDB
 * before any network call, exactly like the board does. Remote is a separate,
 * optional refresh so opening the menu on a plane costs nothing.
 */
export function useNotepads(): NotepadsHandle {
  const session = useDriveSession();
  const user = useAccountStore((state) => state.user);
  const [local, setLocal] = useState<BoardMeta[] | null>(null);
  const [remote, setRemote] = useState<RemoteBoard[]>([]);
  const [server, setServer] = useState<BoardSummary[]>([]);

  const refreshLocal = useCallback(async () => {
    const boards = await listBoards().catch(() => [] as BoardMeta[]);
    setLocal(boards);
    return boards;
  }, []);

  /**
   * The account list.
   *
   * The store is asked once first: the launcher needs the answer before the
   * first account request has necessarily finished, and asking again is free
   * because `refresh` shares one in-flight promise.
   */
  const refreshServer = useCallback(async () => {
    if (!useAccountStore.getState().user) {
      await useAccountStore.getState().refresh().catch(() => undefined);
    }

    const boards = await listServerLibrary().catch(() => [] as BoardSummary[]);
    setServer(boards);
    return boards;
  }, []);

  const refreshRemote = useCallback(async () => {
    // Both remote shelves refresh together: a person who signed in expects the
    // menu to show the library, not only its Drive half.
    void refreshServer();

    if (!session) {
      setRemote([]);
      return [] as RemoteBoard[];
    }
    const boards = await listRemoteLibrary().catch(() => [] as RemoteBoard[]);
    setRemote(boards);
    return boards;
  }, [session, refreshServer]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await seedDemoBoard().catch(() => undefined);
      const boards = await listBoards().catch(() => [] as BoardMeta[]);
      if (!cancelled) setLocal(boards);
    })();

    // Who is signed in decides whether the account shelf exists at all. This
    // runs on the launcher too, so the second-device list is ready before the
    // chooser paints.
    void useAccountStore.getState().refresh().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  // Signing out must not leave another account's notepads on screen.
  useEffect(() => {
    if (!session) setRemote([]);
  }, [session]);

  useEffect(() => {
    if (!user) {
      setServer([]);
      return;
    }
    void refreshServer();
  }, [refreshServer, user]);

  const items = useMemo(
    () => (local ? buildShelf(local, remote, server) : null),
    [local, remote, server],
  );

  return { items, local: local ?? [], server, refreshLocal, refreshRemote, refreshServer };
}
