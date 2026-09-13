import type { Tool } from "@penpaper/engine";
import type { ReactElement } from "react";

/**
 * One 16 px grid, one stroke weight, one icon set.
 *
 * The reference doc is explicit that copying Excalidraw's artwork is not the
 * goal: the point is that every icon comes from the same hand, so the toolbar
 * does not look stitched together from three icon libraries.
 */
export function ToolIcon({ tool }: { tool: Tool }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths(tool)}
    </svg>
  );
}

function paths(tool: Tool): ReactElement {
  switch (tool) {
    case "hand":
      return (
        <>
          <path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11" />
          <path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11" />
          <path d="M14 11V5.5a1.5 1.5 0 0 1 3 0V13" />
          <path d="M17 11.5a1.5 1.5 0 0 1 3 0v3A6.5 6.5 0 0 1 13.5 21H13a6 6 0 0 1-4.2-1.7L5 15.4a1.6 1.6 0 0 1 2.3-2.2L8 14" />
        </>
      );

    case "select":
      return (
        <>
          <path d="M5 3.5 18.5 12l-5.6 1.4L10.5 19z" />
        </>
      );

    case "rectangle":
      return <rect x="4" y="6" width="16" height="12" rx="1.5" />;

    case "diamond":
      return <path d="M12 3.5 20.5 12 12 20.5 3.5 12z" />;

    case "ellipse":
      return <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />;

    case "arrow":
      return (
        <>
          <path d="M4 20 20 4" />
          <path d="M13.5 4H20v6.5" />
        </>
      );

    case "line":
      return <path d="M5 19 19 5" />;

    case "freedraw":
      return (
        <>
          <path d="M5 19.5 9 19l9.5-9.5-3-3L5.5 16z" />
          <path d="M14 7.5l2.5 2.5" />
          <path d="M4 21h6" />
        </>
      );

    case "text":
      return (
        <>
          <path d="M5.5 5.5h13" />
          <path d="M12 5.5v13" />
          <path d="M9 18.5h6" />
        </>
      );

    case "eraser":
      return (
        <>
          <path d="M4.5 15.5 13 7l5.5 5.5L13 18H8z" />
          <path d="M9 21h11" />
        </>
      );
  }
}
