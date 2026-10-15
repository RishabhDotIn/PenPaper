"use client";

import { useState } from "react";
import { ApiError } from "@/lib/collab/api";
import { useAccountStore } from "@/lib/collab/account";
import { DriveAuthError, adoptSession, requestGrant, signOut as disconnectDrive } from "@/lib/drive/auth";

/**
 * The PenPaper account row.
 *
 * One Google consent, not two: the popup asks for the address and for Drive in
 * the same breath, so a new account arrives connected. There is no password to
 * invent, reset, or leak.
 *
 * The button is ours rather than Google's iframe because the popup comes from
 * Google's token client, which does not need a Google-rendered control. The
 * mark and the wording keep it obviously the Google door.
 */

export interface AccountPanelProps {
  variant?: "menu" | "launcher";
  /** Called after a successful sign-in, once the store has the user. */
  onChanged?: () => void;
}

export function AccountPanel({ variant = "menu", onChanged }: AccountPanelProps) {
  const user = useAccountStore((state) => state.user);
  const configured = useAccountStore((state) => state.configured);
  const phase = useAccountStore((state) => state.phase);
  const signInWithGoogle = useAccountStore((state) => state.signInWithGoogle);
  const signOut = useAccountStore((state) => state.signOut);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const grant = await requestGrant();
      // Keep the Drive half first: the account row and the Drive row should
      // become true together, and a silent-renewal effect must never observe
      // "signed in, no Drive" in the gap between the two updates.
      const adopted = adoptSession(grant);
      try {
        await signInWithGoogle(grant.token);
      } catch (cause) {
        // The account link failed, so the Drive token has nothing to belong to.
        if (adopted) disconnectDrive();
        throw cause;
      }
      onChanged?.();
    } catch (cause) {
      setError(describeFailure(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!configured) return null;

  if (user) {
    return (
      <div className="pp-account" data-testid="account-signed-in">
        {user.picture ? (
          <img
            className="pp-account-avatar"
            src={user.picture}
            alt=""
            referrerPolicy="no-referrer"
            data-testid="account-avatar"
          />
        ) : (
          <span className="pp-account-avatar pp-account-avatar-fallback" aria-hidden="true">
            {(user.name || user.email).slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="pp-account-copy">
          <span className="pp-account-name">{user.name}</span>
          <span className="pp-account-mail">{user.email}</span>
        </span>
        <button
          type="button"
          className="pp-account-action"
          data-testid="account-sign-out"
          disabled={busy}
          onClick={() => {
            void signOut().then(() => {
              // The Drive row is hidden once signed out, so leaving its token
              // alive would mean syncing with no way to see or stop it.
              disconnectDrive();
              onChanged?.();
            });
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="pp-auth" data-testid="account-signed-out">
      <div className="pp-account">
        <span className="pp-account-avatar pp-account-avatar-fallback" aria-hidden="true">
          <PersonIcon />
        </span>
        <span className="pp-account-copy">
          <span className="pp-account-name">On this device</span>
          <span className="pp-account-mail">
            {phase === "loading" ? "Checking your account…" : "Saved on this device"}
          </span>
        </span>
      </div>

      <button
        type="button"
        className="pp-google-signin"
        data-testid="account-sign-in"
        disabled={busy}
        onClick={() => void signIn()}
      >
        <GoogleMark />
        {busy ? "Signing in…" : "Continue with Google"}
      </button>

      {error ? (
        <p className="pp-account-error" role="alert">
          {error}
        </p>
      ) : null}

      {variant === "launcher" ? (
        <p className="pp-auth-hint">
          One Google sign-in keeps your library on every device and connects Drive. PenPaper still
          saves locally when you are signed out.
        </p>
      ) : null}
    </div>
  );
}

function describeFailure(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;

  if (cause instanceof DriveAuthError) {
    if (cause.code === "script-failed") {
      return "Google sign-in could not start. Check that this site is listed under the client id's authorized JavaScript origins.";
    }
    if (
      cause.code === "access_denied" ||
      cause.code === "popup_closed" ||
      cause.code === "popup_closed_by_user"
    ) {
      return "Sign-in was cancelled.";
    }
    return cause.message;
  }

  return "Could not sign in. Try again.";
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8.5" r="3.2" />
      <path d="M5.5 19.2a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

/** Google's four-colour G, the one mark their guidelines ask for. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19Z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
      />
    </svg>
  );
}
