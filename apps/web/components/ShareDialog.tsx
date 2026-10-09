"use client";

import { useEffect, useRef, useState } from "react";
import { AccountPanel } from "@/components/AccountPanel";
import { useAccountStore } from "@/lib/collab/account";
import {
  ApiError,
  createShareLink,
  revokeShareLinks,
  type Role,
  type ShareLink,
} from "@/lib/collab/api";

/**
 * The share card.
 *
 * One live link per role: an editor link is for the person you are drawing
 * with, a viewer link is for the one who should watch. Minting replaces the
 * previous link for that role, so "Share" never leaves an old door open by
 * accident, and turning links off revokes both.
 */

export interface ShareDialogProps {
  boardId: string;
  /** Null until the board has been registered with the server. */
  role: Role | null;
  open: boolean;
  peers: number;
  onClose: () => void;
}

export function ShareDialog({ boardId, role, open, peers, onClose }: ShareDialogProps) {
  const user = useAccountStore((state) => state.user);
  const configured = useAccountStore((state) => state.configured);

  const [selected, setSelected] = useState<Exclude<Role, "owner">>("editor");
  const [link, setLink] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState<"create" | "revoke" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // A new role means a new token; showing the previous link beside the new
  // choice would invite copying the wrong one.
  useEffect(() => {
    setLink(null);
    setCopied(false);
    setError(null);
  }, [selected]);

  const url = link
    ? new URL(link.path, typeof window === "undefined" ? "http://localhost" : window.location.origin)
        .href
    : "";

  const create = async () => {
    setBusy("create");
    setError(null);
    try {
      setLink(await createShareLink(boardId, selected));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not create that link");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    setBusy("revoke");
    setError(null);
    try {
      await revokeShareLinks(boardId);
      setLink(null);
      setCopied(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not turn links off");
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setError("Select the link and copy it");
    }
  };

  const canShare = role === "owner";

  return (
    <div
      className="pp-dialog-layer"
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
      inert={!open}
      data-testid="share-layer"
    >
      <button
        type="button"
        className="pp-dialog-backdrop"
        tabIndex={-1}
        aria-label="Close sharing"
        onClick={onClose}
      />

      <div
        className="pp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        data-testid="share-dialog"
      >
        <header className="pp-dialog-head">
          <h2 id="share-title" className="pp-dialog-title">
            Share this notepad
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="pp-dialog-close"
            aria-label="Close"
            onClick={onClose}
            data-testid="share-close"
          >
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        {role === null ? (
          <div className="pp-dialog-body">
            <p className="pp-dialog-copy">
              This notepad is saved on this device. Sign in to put it in your library and share a
              live copy.
            </p>
            {configured && !user ? <AccountPanel variant="menu" /> : null}
            {!configured ? (
              <p className="pp-dialog-note">
                Sharing is not configured on this deployment. Drawing still works offline.
              </p>
            ) : null}
          </div>
        ) : !canShare ? (
          <div className="pp-dialog-body">
            <p className="pp-dialog-copy">
              You are here through a shared link, as {role === "editor" ? "an editor" : "a viewer"}.
              Only the owner can make new links.
            </p>
            <p className="pp-dialog-note">
              {peers > 1 ? `${peers} people are drawing now.` : "You are the only one here."}
            </p>
          </div>
        ) : (
          <div className="pp-dialog-body">
            <p className="pp-dialog-copy">
              Anyone with the link joins this notepad live. Changes save as you draw.
            </p>

            <div className="pp-dialog-label" id="share-role-label">
              Link can
            </div>
            <div
              className="pp-dialog-segment"
              role="group"
              aria-labelledby="share-role-label"
            >
              <button
                type="button"
                aria-pressed={selected === "editor"}
                onClick={() => setSelected("editor")}
                data-testid="share-role-editor"
              >
                Edit
              </button>
              <button
                type="button"
                aria-pressed={selected === "viewer"}
                onClick={() => setSelected("viewer")}
                data-testid="share-role-viewer"
              >
                View only
              </button>
            </div>

            {link ? (
              <div className="pp-dialog-link">
                <input
                  className="pp-dialog-input"
                  value={url}
                  readOnly
                  aria-label="Share link"
                  data-testid="share-link"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  className="pp-dialog-action"
                  onClick={() => void copy()}
                  data-testid="share-copy"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="pp-dialog-primary"
                onClick={() => void create()}
                disabled={busy !== null}
                data-testid="share-create"
              >
                {busy === "create" ? "Making a link…" : "Create link"}
              </button>
            )}

            {error ? (
              <p className="pp-account-error" role="alert">
                {error}
              </p>
            ) : null}

            <p className="pp-dialog-note">
              {peers > 1
                ? `${peers} people are here now.`
                : "No one else is here yet. The link works whenever they open it."}
            </p>

            <div className="pp-dialog-foot">
              <button
                type="button"
                className="pp-dialog-revoke"
                onClick={() => void revoke()}
                disabled={busy !== null}
                data-testid="share-revoke"
              >
                {busy === "revoke" ? "Turning off…" : "Turn off links"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
