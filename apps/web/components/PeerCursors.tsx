"use client";

import { useEffect, useRef } from "react";
import type { Camera } from "@penpaper/engine";
import type { CollabPeer } from "@/lib/collab/session";

/**
 * Other people's pointers, drawn as DOM rather than into the canvas.
 *
 * The engine's renderer is the wrong owner for this: cursors move on every
 * pointer event from people who are not holding our pen, and repainting the
 * whole board for someone else's mouse would be wasteful. A fixed layer of
 * transformed divs is cheap, stays crisp on every DPR, and can be hidden by the
 * same `pointer-events: none` that keeps it out of hit testing.
 *
 * The camera is read in a frame loop instead of mirrored into React state: a
 * pan must move the cursors without re-rendering the board's chrome.
 */

export interface PeerCursorsProps {
  peers: readonly CollabPeer[];
  getCamera: () => Camera;
}

export function PeerCursors({ peers, getCamera }: PeerCursorsProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const visible = peers.filter((peer) => peer.cursor);

  useEffect(() => {
    if (visible.length === 0) return;

    let frame = 0;
    const move = () => {
      const layer = layerRef.current;
      const camera = getCamera();
      if (layer) {
        for (const node of layer.children) {
          const element = node as HTMLElement;
          const x = Number(element.dataset.x ?? "0");
          const y = Number(element.dataset.y ?? "0");
          const screenX = x * camera.zoom + camera.x;
          const screenY = y * camera.zoom + camera.y;
          const outside =
            screenX < -80 ||
            screenY < -80 ||
            screenX > window.innerWidth + 80 ||
            screenY > window.innerHeight + 80;
          element.style.visibility = outside ? "hidden" : "visible";
          element.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;
        }
      }
      frame = requestAnimationFrame(move);
    };

    frame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frame);
  }, [getCamera, visible.length]);

  return (
    <div ref={layerRef} className="pp-peers" aria-hidden="true" data-testid="peer-cursors">
      {visible.map((peer) => (
        <div
          key={peer.id}
          className="pp-peer"
          data-x={peer.cursor!.x}
          data-y={peer.cursor!.y}
          style={{ color: peer.color }}
        >
          <svg viewBox="0 0 12 16" width={13} height={17} aria-hidden="true" focusable="false">
            <path
              d="M1 1.2 10.4 9.1 6.2 9.8 4.3 14.6Z"
              fill="currentColor"
              stroke="white"
              strokeWidth={0.9}
              strokeLinejoin="round"
            />
          </svg>
          <span className="pp-peer-name" style={{ background: peer.color }}>
            {peer.name}
            {peer.role === "viewer" ? " · view" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
