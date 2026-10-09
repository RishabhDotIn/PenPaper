"use client";

import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/collab/api";
import { useAccountStore } from "@/lib/collab/account";

/**
 * The PenPaper account row.
 *
 * Same component in the launcher and the board menu: one place decides what a
 * signed-out person sees, and one place knows how to turn a failed sign-in into
 * a sentence. The form is inline rather than a modal because it is two fields
 * and a button; a dialog over a dialog would only add a backdrop.
 */

export interface AccountPanelProps {
  variant?: "menu" | "launcher";
  /** Called after a successful sign-in or sign-up, once the store has the user. */
  onChanged?: () => void;
}

export function AccountPanel({ variant = "menu", onChanged }: AccountPanelProps) {
  const user = useAccountStore((state) => state.user);
  const configured = useAccountStore((state) => state.configured);
  const phase = useAccountStore((state) => state.phase);
  const signIn = useAccountStore((state) => state.signIn);
  const signUp = useAccountStore((state) => state.signUp);
  const signOut = useAccountStore((state) => state.signOut);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!configured) return null;

  if (user) {
    return (
      <div className="pp-account" data-testid="account-signed-in">
        <span className="pp-account-avatar pp-account-avatar-fallback" aria-hidden="true">
          {(user.name || user.email).slice(0, 1).toUpperCase()}
        </span>
        <span className="pp-account-copy">
          <span className="pp-account-name">{user.name}</span>
          <span className="pp-account-mail">{user.email}</span>
        </span>
        <button
          type="button"
          className="pp-account-action"
          data-testid="account-sign-out"
          onClick={() => {
            void signOut().then(() => onChanged?.());
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (mode === "sign-up") await signUp(name, email, password);
      else await signIn(email, password);

      setPassword("");
      setOpen(false);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pp-auth" data-testid="account-signed-out">
      <div className="pp-account">
        <span className="pp-account-avatar pp-account-avatar-fallback" aria-hidden="true">
          <PersonIcon />
        </span>
        <span className="pp-account-copy">
          <span className="pp-account-name">On this device</span>
          <span className="pp-account-mail">
            {phase === "loading" ? "Checking your account…" : "Sign in to sync your notepads"}
          </span>
        </span>
        <button
          type="button"
          className="pp-account-action pp-account-connect"
          data-testid="account-open"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
            setError(null);
          }}
        >
          Sign in
        </button>
      </div>

      {open ? (
        <form className="pp-auth-form" onSubmit={(event) => void submit(event)}>
          {mode === "sign-up" ? (
            <label className="pp-auth-field">
              <span>Name</span>
              <input
                name="name"
                autoComplete="name"
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                data-testid="account-name"
              />
            </label>
          ) : null}

          <label className="pp-auth-field">
            <span>Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              data-testid="account-email"
            />
          </label>

          <label className="pp-auth-field">
            <span>Password</span>
            <input
              name="password"
              type="password"
              required
              minLength={mode === "sign-up" ? 8 : 1}
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              data-testid="account-password"
            />
          </label>

          {error ? (
            <p className="pp-account-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="pp-auth-submit"
            disabled={busy}
            data-testid="account-submit"
          >
            {busy
              ? "One moment…"
              : mode === "sign-up"
                ? "Create account"
                : "Sign in"}
          </button>

          <button
            type="button"
            className="pp-auth-switch"
            onClick={() => {
              setMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"));
              setError(null);
            }}
          >
            {mode === "sign-in" ? "New here? Create an account" : "I already have an account"}
          </button>
        </form>
      ) : null}

      {variant === "launcher" ? (
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
