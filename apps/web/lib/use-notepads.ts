"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RemoteBoard } from "@/lib/drive/api";
import { listRemoteLibrary } from "@/lib/drive/sync";
import { useDriveSession } from "@/lib/drive/use-drive-session";
import { buildShelf, seedDemoBoard, type ShelfItem } from "@/lib/library";
import { listBoards, type BoardMeta } from "@/lib/storage";

export interface NotepadsHandle {
  /** Null while the first IndexedDB read is still in flight. */
  items: ShelfItem[] | null;
  local: BoardMeta[];
  refreshLocal: () => Promise<BoardMeta[]>;
  /** Fetches Drive's copy of the list. No-op, and cheap, without a session. */
  refreshRemote: () => Promise<RemoteBoard[]>;
}

/**
 * The device's notepads, plus Drive's when an account is connected.
 *
 * Local first, always: the menu and the launcher must render from IndexedDB
 * before any network call, exactly like the board does. Remote is a separate,
 * optional refresh so opening the menu on a plane costs nothing.
 */
export function useNotepads(): NotepadsHandle {
  const session = useDriveSession();
  const [local, setLocal] = useState<BoardMeta[] | null>(null);
  const [remote, setRemote] = useState<RemoteBoard[]>([]);

  const refreshLocal = useCallback(async () => {
    const boards = await listBoards().catch(() => [] as BoardMeta[]);
    setLocal(boards);
    return boards;
  }, []);

  const refreshRemote = useCallback(async () => {
    if (!session) {
      setRemote([]);
      return [] as RemoteBoard[];
    }
    const boards = await listRemoteLibrary().catch(() => [] as RemoteBoard[]);
    setRemote(boards);
    return boards;
  }, [session]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await seedDemoBoard().catch(() => undefined);
      const boards = await listBoards().catch(() => [] as BoardMeta[]);
      if (!cancelled) setLocal(boards);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Signing out must not leave another account's notepads on screen.
  useEffect(() => {
    if (!session) setRemote([]);
  }, [session]);

  const items = useMemo(() => (local ? buildShelf(local, remote) : null), [local, remote]);

  return { items, local: local ?? [], refreshLocal, refreshRemote };
}
