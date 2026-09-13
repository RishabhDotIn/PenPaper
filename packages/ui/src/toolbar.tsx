"use client";

import { TOOL_LABELS, TOOL_SHORTCUTS, type Tool } from "@penpaper/engine";
import { ToolIcon } from "./icons";

/**
 * The launch set, in the order measured from the reference toolbar minus the
 * tools Phase 1 does not ship (lock, sticky note, overflow menu).
 */
export const TOOL_ORDER: readonly Tool[] = [
  "hand",
  "select",
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  "text",
  "eraser",
];

const SHORTCUT_FOR: Partial<Record<Tool, string>> = {};
for (const [key, tool] of Object.entries(TOOL_SHORTCUTS)) {
  if (!SHORTCUT_FOR[tool]) SHORTCUT_FOR[tool] = key.toUpperCase();
}

export interface ToolbarProps {
  value: Tool;
  onChange: (tool: Tool) => void;
  className?: string;
}

export function Toolbar({ value, onChange, className }: ToolbarProps) {
  return (
    <div
      className={`pp-dock${className ? ` ${className}` : ""}`}
      data-testid="tool-dock"
      role="toolbar"
      aria-label="Drawing tools"
      aria-orientation="horizontal"
    >
      {TOOL_ORDER.map((tool) => {
        const shortcut = SHORTCUT_FOR[tool];
        const label = TOOL_LABELS[tool];

        return (
          <button
            key={tool}
            type="button"
            className="pp-tool-button"
            data-testid="tool-button"
            data-tool={tool}
            aria-label={label}
            aria-pressed={value === tool}
            title={shortcut ? `${label} (${shortcut})` : label}
            onClick={() => onChange(tool)}
          >
            <ToolIcon tool={tool} />
          </button>
        );
      })}
    </div>
  );
}
