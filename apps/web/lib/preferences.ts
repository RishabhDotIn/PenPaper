import type { StyleDefaults } from "@penpaper/engine";
import { DEFAULT_ELEMENT_STYLE } from "@penpaper/shared";

/**
 * Device preferences, not board content.
 *
 * Theme, paper style, and the style a new element starts with are things a
 * person expects to keep across every board on that device, so they live in
 * `localStorage` rather than in the per-board IndexedDB snapshot. The canvas is
 * the exception: it has no localStorage of its own, so these values are pushed
 * into the renderer at startup and whenever they change.
 */

export type ThemePreference = "light" | "dark" | "system";
export type CanvasLayout = "none" | "dots" | "lines";

export interface Preferences {
  theme: ThemePreference;
  /** `null` follows the theme's own paper colour. */
  background: string | null;
  layout: CanvasLayout;
  /** Style stamped onto the next element the active tool creates. */
  style: StyleDefaults;
  /**
   * Drive: keep every device in step automatically. Off, the shelf becomes a
   * per-board choice. Stored on the device, not in the account, because it is a
   * statement about *this* device's battery and data, not about the boards.
   */
  autoSync: boolean;
  /**
   * The notepad `/` hands off to on this device.
   *
   * Opening PenPaper should feel like opening a notebook you left on the table,
   * not a shelf you have to choose from. The id is cleared when that notepad is
   * deleted, and when the device has never opened one the launcher asks instead.
   */
  lastBoardId: string | null;
}

const KEY = "penpaper:prefs:v1";

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  background: null,
  layout: "lines",
  style: { ...DEFAULT_ELEMENT_STYLE },
  autoSync: true,
  lastBoardId: null,
};

const THEMES: ReadonlySet<string> = new Set(["light", "dark", "system"]);
const LAYOUTS: ReadonlySet<string> = new Set(["none", "dots", "lines"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
/** Board ids go straight into a URL, so the same alphabet the router accepts. */
const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Preferences come back from a string the user can edit, or from an older
 * build, so every field is checked before it reaches the renderer. A corrupt
 * value falls back to the default instead of breaking the board.
 */
function normalizeStyle(raw: unknown): StyleDefaults {
  const style: StyleDefaults = { ...DEFAULT_PREFERENCES.style };
  if (!isRecord(raw)) return style;

  if (typeof raw.strokeColor === "string" && HEX_COLOR.test(raw.strokeColor)) {
    style.strokeColor = raw.strokeColor;
  }
  if (raw.backgroundColor === "transparent") {
    style.backgroundColor = "transparent";
  } else if (typeof raw.backgroundColor === "string" && HEX_COLOR.test(raw.backgroundColor)) {
    style.backgroundColor = raw.backgroundColor;
  }
  if (raw.fillStyle === "hachure" || raw.fillStyle === "cross-hatch" || raw.fillStyle === "solid") {
    style.fillStyle = raw.fillStyle;
  }
  if (raw.strokeWidth === 1 || raw.strokeWidth === 2 || raw.strokeWidth === 4) {
    style.strokeWidth = raw.strokeWidth;
  }
  if (raw.strokeStyle === "solid" || raw.strokeStyle === "dashed" || raw.strokeStyle === "dotted") {
    style.strokeStyle = raw.strokeStyle;
  }
  if (raw.roughness === 0 || raw.roughness === 1 || raw.roughness === 2) {
    style.roughness = raw.roughness;
  }
  if (typeof raw.opacity === "number" && raw.opacity >= 0 && raw.opacity <= 100) {
    style.opacity = raw.opacity;
  }
  if (typeof raw.fontSize === "number" && raw.fontSize >= 8 && raw.fontSize <= 200) {
    style.fontSize = raw.fontSize;
  }
  if (raw.fontFamily === "excalifont" || raw.fontFamily === "nunito" || raw.fontFamily === "mono") {
    style.fontFamily = raw.fontFamily;
  }
  if (raw.textAlign === "left" || raw.textAlign === "center" || raw.textAlign === "right") {
    style.textAlign = raw.textAlign;
  }
  if (
    raw.verticalAlign === "top" ||
    raw.verticalAlign === "middle" ||
    raw.verticalAlign === "bottom"
  ) {
    style.verticalAlign = raw.verticalAlign;
  }
  if (typeof raw.lineHeight === "number" && raw.lineHeight >= 1 && raw.lineHeight <= 3) {
    style.lineHeight = raw.lineHeight;
  }
  if (raw.startArrowhead === "none" || raw.startArrowhead === "arrow" || raw.startArrowhead === "dot") {
    style.startArrowhead = raw.startArrowhead;
  }
  if (raw.endArrowhead === "none" || raw.endArrowhead === "arrow" || raw.endArrowhead === "dot") {
    style.endArrowhead = raw.endArrowhead;
  }

  return style;
}

function normalize(raw: unknown): Preferences {
  if (!isRecord(raw)) return { ...DEFAULT_PREFERENCES, style: { ...DEFAULT_PREFERENCES.style } };

  return {
    theme: typeof raw.theme === "string" && THEMES.has(raw.theme)
      ? (raw.theme as ThemePreference)
      : DEFAULT_PREFERENCES.theme,
    background: typeof raw.background === "string" && HEX_COLOR.test(raw.background)
      ? raw.background
      : null,
    layout: typeof raw.layout === "string" && LAYOUTS.has(raw.layout)
      ? (raw.layout as CanvasLayout)
      : DEFAULT_PREFERENCES.layout,
    style: normalizeStyle(raw.style),
    autoSync: typeof raw.autoSync === "boolean" ? raw.autoSync : DEFAULT_PREFERENCES.autoSync,
    lastBoardId:
      typeof raw.lastBoardId === "string" && BOARD_ID.test(raw.lastBoardId)
        ? raw.lastBoardId
        : null,
  };
}

export function loadPreferences(): Preferences {
  if (typeof localStorage === "undefined") return normalize(null);

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return normalize(null);
    return normalize(JSON.parse(raw));
  } catch {
    // Private mode, a quota error, or hand-edited JSON. Defaults are always
    // usable, and the board itself is unaffected.
    return normalize(null);
  }
}

export function savePreferences(preferences: Preferences): void {
  if (typeof localStorage === "undefined") return;

  try {
    localStorage.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Losing a preference is not worth interrupting a drawing session.
  }
}

/**
 * Records the notepad the person is in, so the next visit opens it directly.
 *
 * A device preference, not board content: another device may well be in a
 * different notepad. The write is skipped when nothing changed, because this
 * runs on every board open.
 */
export function rememberBoard(boardId: string): void {
  const current = loadPreferences();
  if (current.lastBoardId === boardId) return;
  savePreferences({ ...current, lastBoardId: boardId });
}

/** Forgets a notepad that no longer exists, without touching other prefs. */
export function forgetBoard(boardId: string): void {
  const current = loadPreferences();
  if (current.lastBoardId !== boardId) return;
  savePreferences({ ...current, lastBoardId: null });
}

/** What the theme preference means right now. */
export function effectiveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): "light" | "dark" {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}
