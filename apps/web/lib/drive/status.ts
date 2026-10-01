import type { SyncPhase } from "@/store/sync-store";

export type SyncTone = "ok" | "busy" | "error" | "off";

export interface SyncDescription {
  label: string;
  tone: SyncTone;
}

/**
 * One sentence for the same state in three places: the board menu, the shelf
 * header, and the account chip. Keeping it in one function stops them drifting
 * into three different words for "not connected".
 */
export function describeSync(
  connected: boolean,
  phase: SyncPhase,
  lastSyncedAt: number | null,
  message: string | null,
): SyncDescription {
  if (!connected) return { label: "Not connected to Drive", tone: "off" };
  if (phase === "syncing") return { label: "Syncing…", tone: "busy" };
  if (phase === "error") return { label: message ?? "Could not sync", tone: "error" };

  if (!lastSyncedAt) return { label: "Connected to Drive", tone: "ok" };

  const minutes = Math.round((Date.now() - lastSyncedAt) / 60_000);
  const when =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${minutes}m ago`
        : `${Math.round(minutes / 60)}h ago`;

  return { label: `Synced ${when}`, tone: "ok" };
}
