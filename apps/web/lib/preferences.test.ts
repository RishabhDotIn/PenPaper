import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  effectiveTheme,
  forgetBoard,
  loadPreferences,
  rememberBoard,
  savePreferences,
} from "./preferences";

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });

  return store;
}

describe("preferences", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installStorage();
  });

  it("returns defaults when nothing has been saved", () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("round-trips theme, background, layout, and style", () => {
    const value = {
      ...DEFAULT_PREFERENCES,
      theme: "dark" as const,
      background: "#fff9db",
      layout: "dots" as const,
      style: { ...DEFAULT_PREFERENCES.style, strokeColor: "#e03131", strokeWidth: 4 as const },
    };

    savePreferences(value);

    expect(loadPreferences()).toEqual(value);
  });

  it("remembers that auto-sync was turned off on this device", () => {
    savePreferences({ ...DEFAULT_PREFERENCES, autoSync: false });
    expect(loadPreferences().autoSync).toBe(false);
  });

  it("treats a non-boolean auto-sync as the default, on", () => {
    store.set("penpaper:prefs:v1", JSON.stringify({ autoSync: "yes" }));
    expect(loadPreferences().autoSync).toBe(true);
  });

  it("remembers the notepad to reopen and forgets a deleted one", () => {
    rememberBoard("notepad-7");
    expect(loadPreferences().lastBoardId).toBe("notepad-7");

    // Forgetting a different notepad must not clear the remembered one.
    forgetBoard("notepad-8");
    expect(loadPreferences().lastBoardId).toBe("notepad-7");

    forgetBoard("notepad-7");
    expect(loadPreferences().lastBoardId).toBeNull();
  });

  it("drops a remembered id that is not a board id", () => {
    store.set("penpaper:prefs:v1", JSON.stringify({ lastBoardId: "../../etc/passwd" }));
    expect(loadPreferences().lastBoardId).toBeNull();
  });

  it("falls back to defaults for corrupt JSON", () => {
    store.set("penpaper:prefs:v1", "{not json");

    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("rejects values that would break the renderer", () => {
    store.set(
      "penpaper:prefs:v1",
      JSON.stringify({
        theme: "neon",
        background: "red",
        layout: "checks",
        style: { strokeWidth: 99, opacity: 400, fontFamily: "comic" },
      }),
    );

    const loaded = loadPreferences();
    expect(loaded.theme).toBe("system");
    expect(loaded.background).toBeNull();
    expect(loaded.layout).toBe("lines");
    expect(loaded.style.strokeWidth).toBe(DEFAULT_PREFERENCES.style.strokeWidth);
    expect(loaded.style.opacity).toBe(DEFAULT_PREFERENCES.style.opacity);
    expect(loaded.style.fontFamily).toBe(DEFAULT_PREFERENCES.style.fontFamily);
  });

  it("resolves the system theme against the media query", () => {
    expect(effectiveTheme("system", true)).toBe("dark");
    expect(effectiveTheme("system", false)).toBe("light");
    expect(effectiveTheme("dark", false)).toBe("dark");
    expect(effectiveTheme("light", true)).toBe("light");
  });
});
