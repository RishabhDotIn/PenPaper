import { create } from "zustand";
import type { DriveAccount } from "@/lib/drive/auth";

/**
 * What the chrome needs to know about Drive: who is connected, whether work is
 * in flight, and when this device last agreed with the account.
 *
 * Deliberately not the session itself — the token lives in `drive/auth`, never
 * in React state that a devtools inspector or a bug report would print.
 */
export type SyncPhase = "idle" | "syncing" | "error";

export interface SyncStoreState {
  account: DriveAccount | null;
  phase: SyncPhase;
  message: string | null;
  /** Epoch ms of the last successful push or pull, on any board. */
  lastSyncedAt: number | null;

  setAccount(account: DriveAccount | null): void;
  setPhase(phase: SyncPhase, message?: string | null): void;
  markSynced(at: number): void;
  reset(): void;
}

const INITIAL = {
  account: null,
  phase: "idle",
  message: null,
  lastSyncedAt: null,
} satisfies Pick<SyncStoreState, "account" | "phase" | "message" | "lastSyncedAt">;

export const useSyncStore = create<SyncStoreState>((set) => ({
  ...INITIAL,

  setAccount: (account) => set({ account }),
  setPhase: (phase, message = null) => set({ phase, message }),
  markSynced: (lastSyncedAt) => set({ lastSyncedAt, phase: "idle", message: null }),
  reset: () => set({ ...INITIAL }),
}));
