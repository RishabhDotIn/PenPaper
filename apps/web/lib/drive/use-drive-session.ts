"use client";

import { useEffect, useState } from "react";
import { getSession, subscribeDrive, type DriveSession } from "./auth";
import { useSyncStore } from "@/store/sync-store";

/**
 * The live Drive session, for components that need to react to sign-in and
 * sign-out. `getSession()` is a plain read; this subscribes to the module's
 * changes and keeps the sync store's account in step for the chrome.
 */
export function useDriveSession(): DriveSession | null {
  const [session, setSession] = useState<DriveSession | null>(null);

  useEffect(() => {
    const sync = () => setSession(getSession());
    sync();
    return subscribeDrive(sync);
  }, []);

  useEffect(() => {
    useSyncStore.getState().setAccount(session?.account ?? null);
  }, [session]);

  return session;
}
