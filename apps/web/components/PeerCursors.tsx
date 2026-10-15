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
 * There are two clocks here. A peer's position arrives in presence frames, a
 * dozen times a second at best, so drawing it straight makes pointers hop. Each
 * frame eases the drawn point toward the last one received instead, which is
 * what makes a hand across the board look like a hand rather than a slideshow.
 * The camera is read in the same loop instead of mirrored into React state: a
 * pan must move the cursors without re-rendering the board's chrome.
 */

export interface PeerCursorsProps {
  peers: readonly CollabPeer[];
  getCamera: () => Camera;
}

/** Milliseconds to close most of the gap to the newest position. */
const EASE_MS = 90;

export function PeerCursors({ peers, getCamera }: PeerCursorsProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  /** Where each pointer is being drawn, keyed by peer id. */
  const drawnRef = useRef(new Map<string, { x: number; y: number }>());
  const visible = peers.filter((peer) => peer.cursor);

  useEffect(() => {
    if (visible.length === 0) return;

    const drawn = drawnRef.current;
    let frame = 0;
    let last = performance.now();

    const move = (now: number) => {
      const layer = layerRef.current;
      const camera = getCamera();
      // A backgrounded tab can resume with a huge gap; one long frame should
      // not teleport every pointer across the board.
      const dt = Math.min(64, Math.max(0, now - last));
      last = now;
      const follow = 1 - Math.exp(-dt / EASE_MS);

      if (layer) {
        const alive = new Set<string>();
        for (const node of layer.children) {
          const element = node as HTMLElement;
          const id = element.dataset.peerId ?? "";
          alive.add(id);

          const targetX = Number(element.dataset.x ?? "0");
          const targetY = Number(element.dataset.y ?? "0");
          let point = drawn.get(id);
          if (!point) {
            // First sighting: land exactly where they are, do not fly in.
            point = { x: targetX, y: targetY };
            drawn.set(id, point);
          } else {
            point.x += (targetX - point.x) * follow;
            point.y += (targetY - point.y) * follow;
            // Below a sub-pixel the easing is invisible; snap so a resting
            // pointer does not keep a transform that never settles.
            if (Math.abs(targetX - point.x) < 0.05) point.x = targetX;
            if (Math.abs(targetY - point.y) < 0.05) point.y = targetY;
          }

          const screenX = point.x * camera.zoom + camera.x;
          const screenY = point.y * camera.zoom + camera.y;
          const outside =
            screenX < -80 ||
            screenY < -80 ||
            screenX > window.innerWidth + 80 ||
            screenY > window.innerHeight + 80;
          element.style.visibility = outside ? "hidden" : "visible";
          element.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;
        }

        for (const id of [...drawn.keys()]) {
          if (!alive.has(id)) drawn.delete(id);
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
          data-peer-id={peer.id}
          data-x={peer.cursor!.x}
          data-y={peer.cursor!.y}
          style={{ color: peer.color }}
        >
          <svg viewBox="0 0 12 16" width={13} height={17} aria-hidden="true" focusable="false">
            <path
              d="M1 1.2 10.4 9.1 6.2 9.8 4.3 14.6Z"
              fill="currentColor"
              stroke="white"
              strokeWidth={1.1}
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
