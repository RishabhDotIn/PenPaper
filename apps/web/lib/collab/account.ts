import { create } from "zustand";
import {
  ApiError,
  fetchAccount,
  signIn as apiSignIn,
  signOut as apiSignOut,
  signUp as apiSignUp,
  type Account,
} from "./api";

/**
 * Who is signed in, and whether this deployment has accounts at all.
 *
 * Kept in a store rather than in each component: the launcher, the menu, the
 * share dialog, and the board's sync effect all ask the same question, and a
 * single fetch is enough to answer it for all of them.
 */

export type AccountPhase = "idle" | "loading" | "ready" | "error";

export interface AccountStoreState {
  user: Account | null;
  configured: boolean;
  collab: boolean;
  phase: AccountPhase;
  error: string | null;

  refresh(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

let inFlight: Promise<void> | null = null;

export const useAccountStore = create<AccountStoreState>((set, get) => ({
  user: null,
  configured: false,
  collab: false,
  phase: "idle",
  error: null,

  refresh: async () => {
    // The launcher and the board both ask on mount; one request answers both.
    if (inFlight) return inFlight;

    const first = get().phase === "idle";
    if (first) set({ phase: "loading" });

    inFlight = (async () => {
      try {
        const state = await fetchAccount();
        set({
          user: state.user,
          configured: state.configured,
          collab: state.collab,
          phase: "ready",
          error: null,
        });
      } catch (error) {
        // Offline is not a sign-out: keep the last known user and let the next
        // request correct it.
        set({
          phase: "error",
          error: error instanceof ApiError ? error.message : "Could not check your account",
        });
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  },

  signIn: async (email, password) => {
    const { user } = await apiSignIn({ email, password });
    set({ user, phase: "ready", error: null });
  },

  signUp: async (name, email, password) => {
    const { user } = await apiSignUp({ name, email, password });
    set({ user, phase: "ready", error: null });
  },

  signOut: async () => {
    await apiSignOut().catch(() => undefined);
    set({ user: null, phase: "ready", error: null });
  },
}));

/** Reads the store from non-React code such as the autosave queue. */
export function accountUser(): Account | null {
  return useAccountStore.getState().user;
}
