"use client";

import { useEffect, useState } from "react";
import type { CollabPeer } from "@/lib/collab/session";

/**
 * Who is in the room, and the host's one moderation control.
 *
 * Live used to be a line inside the menu, which meant you had to open the menu
 * to learn that other people were drawing with you. The pill sits over the
 * canvas for as long as a room is open; the roster is one tap behind it, so a
 * name on a pointer can be matched to a person without leaving the board.
 */

export interface LivePanelProps {
  status: "connecting" | "online";
  peers: readonly CollabPeer[];
  /** Only the host may show someone out; the server enforces it too. */
  canRemove: boolean;
  onRemove?: (id: string) => void;
}

export function LivePanel({ status, peers, canRemove, onRemove }: LivePanelProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Keep the card in the DOM for its exit animation, like the style card.
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const timer = window.setTimeout(() => setMounted(false), 170);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  // The pill is not a modal, so anything outside it dismisses the card.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".pp-live-wrap")) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // A room that closes while the card is open must not leave it floating.
  useEffect(() => {
    if (status === "connecting") setOpen(false);
  }, [status]);

  return (
    <div className="pp-live-wrap" data-testid="live-panel">
      <button
        type="button"
        className="pp-live-pill"
        data-testid="live-pill"
        data-state={status}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          open
            ? "Hide who is here"
            : `Show who is here (${peers.length || 1})`
        }
        onClick={() => setOpen((value) => !value)}
      >
        <span className="pp-live-dot" data-state={status} aria-hidden="true" />
        <span className="pp-live-text">{status === "connecting" ? "Connecting" : "Live"}</span>
        <span className="pp-live-count" aria-hidden="true">
          {peers.length || 1}
        </span>
      </button>

      {mounted ? (
        <div
          className="pp-live-pop"
          data-state={open ? "open" : "closed"}
          data-testid="live-popover"
          role="dialog"
          aria-label="People in this notepad"
        >
          <p className="pp-live-title">In this notepad</p>

          {peers.length === 0 ? (
            <p className="pp-live-empty">Joining the room…</p>
          ) : (
            <ul className="pp-live-list">
              {peers.map((peer) => (
                <li className="pp-live-row" key={peer.id} data-testid="live-row">
                  <span
                    className="pp-live-swatch"
                    style={{ background: peer.color }}
                    aria-hidden="true"
                  />
                  <span className="pp-live-name">
                    {peer.name}
                    {peer.you ? <span className="pp-live-you"> you</span> : null}
                  </span>
                  <span className="pp-live-role">{roleLabel(peer)}</span>
                  {canRemove && !peer.you && peer.role !== "owner" ? (
                    <button
                      type="button"
                      className="pp-live-remove"
                      data-testid="live-remove"
                      title={`Remove ${peer.name}`}
                      onClick={() => onRemove?.(peer.id)}
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <p className="pp-live-hint">
            {canRemove
              ? "Sharing the link lets people draw. Removing someone closes their connection."
              : "You joined through a shared link."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function roleLabel(peer: CollabPeer): string {
  if (peer.role === "owner") return "Host";
  if (peer.role === "viewer") return "Viewer";
  return "Editor";
}
