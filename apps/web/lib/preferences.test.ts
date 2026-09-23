import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  effectiveTheme,
  loadPreferences,
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
