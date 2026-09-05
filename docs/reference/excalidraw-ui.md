# Excalidraw UI reference

Captured from <https://excalidraw.com/> on 2026-10-31 by reading computed styles
out of the running app. Numbers here are measured, not remembered. Use them as
the starting point for `packages/ui` tokens; deviate deliberately, never by
accident.

## Geometry

| Thing | Measured value |
|---|---|
| Toolbar island | 44 px tall, 8 px radius, horizontally centred, 16 px from the top |
| Tool button | 36 × 36 px, 8 px radius, transparent until hover |
| Default icon size | 16 px |
| Island shadow | `0 0 1px rgba(0,0,0,.17), 0 0 3px rgba(0,0,0,.08), 0 7px 14px rgba(0,0,0,.05)` |
| UI font | `Assistant, system-ui, BlinkMacSystemFont, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` |
| Canvas font (hand-drawn) | `Excalifont` (OFL, self-hosted) |

Our constraint is stricter than theirs: **44 px minimum touch target on coarse
pointers**, so a 36 px button grows its hit area with padding, not its visual
size.

## Tool order (top island, left to right)

`lock` · `hand` · `selection` · `rectangle` · `diamond` · `ellipse` · `arrow` ·
`line` · `draw` · `text` · `sticky note` · `eraser` · `more`

We ship the first eleven minus sticky notes at launch. Sticky notes are Phase 4
at the earliest; they are not a resume claim.

## Light theme

```css
--color-primary: #6965db;
--color-primary-darker: #5b57d1;
--color-primary-darkest: #4a47b1;
--color-primary-light: #e3e2fe;
--color-primary-light-darker: #d7d5ff;
--color-primary-hover: #5753d0;

--color-surface-lowest: #ffffff;
--color-surface-low: #ececf4;
--color-surface-mid: #f6f6f9;
--color-surface-high: #f1f0ff;
--color-surface-primary-container: #e0dfff;
--color-on-surface: #1b1b1f;

--color-gray-10: #f5f5f5;
--color-gray-20: #ebebeb;
--color-gray-30: #d6d6d6;
--color-gray-40: #b8b8b8;
--color-gray-50: #999999;
--color-gray-60: #7a7a7a;
--color-gray-70: #5c5c5c;
--color-gray-80: #3d3d3d;
--color-gray-85: #242424;
--color-gray-90: #1e1e1e;
--color-gray-100: #121212;

--color-danger: #db6965;
--color-danger-darker: #d65550;
--color-success: #cafccc;
--color-success-text: #268029;
--color-warning: #fceeca;
--color-warning-dark: #f5c354;

--color-selection: #6965db;
--select-highlight-color: #339af0;
--focus-highlight-color: #a5d8ff;

--default-bg-color: #ffffff;
--island-bg-color: #ffffff;
--input-bg-color: #ffffff;
--input-border-color: #ced4da;
--input-label-color: #495057;
--link-color: #1c7ed6;
--overlay-bg-color: rgba(12, 12, 14, .35);
```

## Dark theme

```css
--color-surface-lowest: hsl(0, 0%, 7%);
--color-surface-low: hsl(240, 8%, 15%);
--color-surface-mid: hsl(240, 6%, 10%);
--color-surface-high: #2e2d39;
--color-surface-primary-container: #403e6a;
--color-on-surface: #e3e3e8;
--color-brand-hover: #bbb8ff;
--color-brand-active: #d0ccff;
--color-on-primary-container: #e0dfff;

--default-bg-color: #121212;
--island-bg-color: #232329;
```

The dark surface ramp is deliberately *not* the light ramp inverted. It is a
narrow band of near-blacks plus one raised violet-tinted panel colour, which is
why Excalidraw's dark mode still reads as calm rather than muddy.

## What we copy, and what we do not

**Copy:** the island metaphor (floating panels over an infinite canvas), the
8 px radius, the shadow stack, the 16 px icon grid, the violet-primary ramp,
the light/dark surface ramps, and the 36 px visual button with a 44 px hit area.

**Do not copy:** their exact toolbar composition or icon artwork. Our toolbar is
rebuilt from our own element types, and the icons come from a single consistent
set so the app does not look like a stitched-together clone.

## Where this lives in code

- `packages/ui/src/tokens.css` — the CSS custom properties above, with our brand
  name on the same ramp.
- `packages/engine/src/theme.ts` — the same colours as plain TypeScript objects.
  The canvas renderer must never read CSS variables inside the frame loop.
- Grid colour: `--color-gray-20` in light, `--color-surface-high` in dark.

The engine/UI split matters here: a theme change updates a TS object and a CSS
file, and both stay in sync because `tokens.css` is generated from `theme.ts` in
Phase 2, not hand-maintained twice.
