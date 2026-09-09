/**
 * Canvas colours as plain objects.
 *
 * The renderer never reads CSS variables: `getComputedStyle` inside a frame
 * loop forces style recalculation and turns a 2 ms frame into a 12 ms one.
 * These values mirror the tokens in `apps/web/app/globals.css`.
 */
export interface Theme {
  background: string;
  grid: string;
  gridMajor: string;
  selection: string;
  selectionFill: string;
  text: string;
  stroke: string;
  /** Handles and guides, which must read clearly on any board colour. */
  accent: string;
}

export const lightTheme: Theme = {
  background: "#ffffff",
  grid: "#ebebeb",
  gridMajor: "#d6d6d6",
  selection: "#6965db",
  selectionFill: "rgba(105, 101, 219, 0.08)",
  text: "#1b1b1f",
  stroke: "#1e1e1e",
  accent: "#6965db",
};

export const darkTheme: Theme = {
  background: "#121212",
  grid: "#2e2d39",
  gridMajor: "#3d3d4a",
  selection: "#a8a5ff",
  selectionFill: "rgba(168, 165, 255, 0.10)",
  text: "#e3e3e8",
  stroke: "#e3e3e8",
  accent: "#a8a5ff",
};
