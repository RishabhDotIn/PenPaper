"use client";

import { FONT_STACKS, sceneToScreen, type Camera } from "@penpaper/engine";
import type { Element } from "@penpaper/shared";
import { useCallback, useEffect, useRef, useState } from "react";

export interface TextEditorOverlayProps {
  element: Element;
  camera: Camera;
  /** Called once, when editing ends with content. */
  onCommit: (text: string) => void;
  /** Called once, when editing ends without a change worth keeping. */
  onCancel?: () => void;
}

/** Keeps iOS from zooming the page when the textarea receives focus. */
const MIN_EDITABLE_FONT_PX = 16;

/**
 * A textarea laid on top of the canvas, not a custom text engine.
 *
 * Letting the browser own the caret, selection, IME, and undo costs nothing and
 * gets every platform's text behaviour right for free. The element is only
 * touched once, when editing ends.
 */
export function TextEditorOverlay({ element, camera, onCommit, onCancel }: TextEditorOverlayProps) {
  const nodeRef = useRef<HTMLTextAreaElement | null>(null);
  const doneRef = useRef(false);
  const composingRef = useRef(false);

  const [value, setValue] = useState(element.text);
  const [lift, setLift] = useState(0);

  const origin = sceneToScreen(camera, { x: element.x, y: element.y });
  const fontSize = Math.max(MIN_EDITABLE_FONT_PX, element.fontSize * camera.zoom);
  const lineHeight = fontSize * element.lineHeight;
  const width = Math.max(24, element.width * camera.zoom);
  const height = Math.max(lineHeight + 8, element.height * camera.zoom);

  const finish = useCallback(
    (commit: boolean) => {
      if (doneRef.current) return;
      doneRef.current = true;

      if (!commit) {
        if (onCancel) onCancel();
        else onCommit(value);
        return;
      }

      onCommit(value);
    },
    [onCancel, onCommit, value],
  );

  // Focus at the end of the existing text: editing a note should not put the
  // caret before the first word.
  //
  // Deferred by a frame on purpose. The pointerdown that creates the element is
  // followed by the browser's default mousedown focus change, which would blur
  // the textarea immediately if it had already taken focus.
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;

    const frame = requestAnimationFrame(() => {
      node.focus({ preventScroll: true });
      const end = node.value.length;
      node.setSelectionRange(end, end);
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  // Grow with wrapped lines so the box never hides text mid-edit.
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;

    node.style.height = "auto";
    node.style.height = `${Math.max(node.scrollHeight, height)}px`;
  }, [value, height]);

  /**
   * Keep the caret in the top third of the *visible* viewport.
   *
   * On Android the on-screen keyboard shrinks `visualViewport` without
   * shrinking the layout viewport, so a text box near the bottom would sit
   * underneath it. Lifting the overlay is the only positioning that works when
   * the page itself cannot scroll.
   */
  useEffect(() => {
    const node = nodeRef.current;
    const viewport = window.visualViewport;
    if (!node || !viewport) return;

    const adjust = () => {
      const rect = node.getBoundingClientRect();
      const target = viewport.offsetTop + viewport.height / 3;
      setLift(Math.max(0, rect.top - target));
    };

    adjust();
    viewport.addEventListener("resize", adjust);
    viewport.addEventListener("scroll", adjust);
    return () => {
      viewport.removeEventListener("resize", adjust);
      viewport.removeEventListener("scroll", adjust);
    };
  }, []);

  return (
    <textarea
      ref={nodeRef}
      data-testid="text-overlay"
      aria-label="Text"
      value={value}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
      }}
      onKeyDown={(event) => {
        // Never act on a key that is part of an IME composition; committing
        // here would split a word the user is still assembling.
        if (event.nativeEvent.isComposing || composingRef.current) return;

        if (event.key === "Escape") {
          event.preventDefault();
          finish(value !== element.text);
          return;
        }

        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          finish(true);
        }
      }}
      style={{
        position: "absolute",
        left: origin.x,
        top: origin.y - lift,
        width,
        height,
        zIndex: 20,

        margin: 0,
        padding: 0,
        border: "none",
        outline: "2px solid var(--primary)",
        outlineOffset: 2,
        borderRadius: 2,
        resize: "none",
        overflow: "hidden",

        background: "transparent",
        color: element.strokeColor === "transparent" ? "var(--on-surface)" : element.strokeColor,
        caretColor: "var(--primary)",
        font: `${fontSize}px ${FONT_STACKS[element.fontFamily]}`,
        lineHeight: `${lineHeight}px`,
        textAlign: element.textAlign,
        whiteSpace: "pre-wrap",
        transform: element.angle ? `rotate(${element.angle}rad)` : undefined,
        transformOrigin: "top left",
      }}
    />
  );
}
