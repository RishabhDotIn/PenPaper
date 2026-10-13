"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/collab/api";
import { useAccountStore } from "@/lib/collab/account";
import { signOut as disconnectDrive } from "@/lib/drive/auth";
import { googleClientId, googleConfigured, googleId, loadGisScript } from "@/lib/google/gis";

/**
 * The PenPaper account row.
 *
 * Same component in the launcher and the board menu: one place decides what a
 * signed-out person sees, and one place knows how to turn a failed sign-in into
 * a sentence. Google is the only door — there is no password to invent, reset,
 * or leak — and its own button is used rather than a lookalike, because that
 * button is the one Google's popup trusts for a user gesture.
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

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<"loading" | "ready" | "failed">("loading");

  const targetRef = useRef<HTMLDivElement | null>(null);

  // The popup hands back a credential when the person finishes. Kept in a ref
  // so re-rendering the row (a new `onChanged` identity, a parent state change)
  // never tears down and re-renders Google's iframe button.
  const finish = useRef<(credential: string | undefined) => Promise<void>>(async () => {});
  finish.current = async (credential) => {
    if (!credential) {
      setError("Google did not return a sign-in. Try again.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle(credential);
      setOpen(false);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;

    const target = targetRef.current;
    if (!target) return;

    let cancelled = false;
    setSlot("loading");

    void (async () => {
      try {
        if (!googleConfigured()) throw new Error("no client id");
        await loadGisScript();

        const api = googleId();
        if (!api) throw new Error("no id api");
        if (cancelled) return;

        api.initialize({
          client_id: googleClientId(),
          ux_mode: "popup",
          cancel_on_tap_outside: true,
          callback: (response) => {
            void finish.current(response.credential);
          },
        });

        target.replaceChildren();
        api.renderButton(target, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "left",
          width: 260,
        });

        if (!cancelled) setSlot("ready");
      } catch {
        if (!cancelled) setSlot("failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

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
        <button
          type="button"
          className="pp-account-action pp-account-connect"
          data-testid="account-open"
          aria-expanded={open}
          disabled={busy}
          onClick={() => {
            setOpen((value) => !value);
            setError(null);
          }}
        >
          Sign in
        </button>
      </div>

      {open ? (
        <div className="pp-google">
          <div ref={targetRef} className="pp-google-button" data-state={slot} />

          {slot === "failed" ? (
            <p className="pp-account-error" role="alert">
              Google sign-in could not start. Check that this site is listed under the client id&apos;s
              authorized JavaScript origins.
            </p>
          ) : null}

          {error ? (
            <p className="pp-account-error" role="alert">
              {error}
            </p>
          ) : null}

          <p className="pp-auth-hint">
            Your notepads follow you to every device you sign in on. Nothing is uploaded until you
            sign in.
          </p>
        </div>
      ) : null}

      {variant === "launcher" && !open ? (
        <p className="pp-auth-hint">
          An account keeps one library on every device. PenPaper still saves locally when you are
          signed out.
        </p>
      ) : null}
    </div>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8.5" r="3.2" />
      <path d="M5.5 19.2a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}
