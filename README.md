# PenPaper

An infinite whiteboard that keeps up with a pen, a finger, or a mouse. It is
local-first: every stroke is written to the device immediately, the board
reopens exactly where you left it, and the installed app keeps working when the
network does not.

**Live demo:** _deployment pending — see [Deploying](#deploying)._

| Desktop | Phone |
| --- | --- |
| ![PenPaper on desktop](docs/screenshots/penpaper-desktop.png) | ![PenPaper on a phone](docs/screenshots/penpaper-phone.png) |

## What works today (Phase 1)

- **Infinite canvas** with scroll-to-pan, pinch-to-zoom, and a cached grid.
- **Freehand drawing** with pressure-sensitive strokes (Perfect Freehand), palm
  rejection, and coalesced pointer samples.
- **Shapes** — rectangle, ellipse, diamond, line, and arrow — drawn with
  Rough.js in the Excalidraw visual language (hachure, cross-hatch, solid).
- **Text** with a real browser textarea overlay, IME composition, wrapped
  layout, and no iOS focus zoom.
- **Selection and transforms** — click, shift-click, marquee, move, resize from
  eight handles, and rotate, including on rotated elements. A finished pen
  stroke stays unselected, so fresh writing never grows resize handles and the
  style panel keeps pointing at the next stroke.
- **A style box that works before you draw.** Pick the pen, a shape, or the text
  tool and the panel edits the *next* element: stroke and background colour,
  fill, stroke width, dash, roughness, opacity, font, and arrowheads. Pick
  something on the canvas and the same panel edits that selection. The choice
  is remembered per device.
- **Hamburger menu** for the board itself: undo/redo, theme (light, dark, or
  system), canvas background presets, canvas layout (plain, dotted, or boxed
  paper), PNG export of the current view, and a two-tap reset that is undoable.
- **Eraser**, delete, and a transaction-based undo/redo history.
- **Local persistence** through IndexedDB: 500 ms debounced autosave, a flush on
  `pagehide`, and camera restoration on reload. Theme, paper, layout, and style
  defaults persist separately in `localStorage`.
- **Responsive chrome** measured against excalidraw.com: a vertical dock on
  desktop, a two-row dock on phones, a right-side style panel from tablet width
  up, and a content-sized style card behind a palette button on smaller screens.
  The bottom edge holds the dock alone — there is no permanent colour bar, and
  no title bar or wordmark. Every coarse-pointer target is at least 44 px.
- **Installable PWA** with offline app shell, manifest, maskable icons, and a
  service worker that serves the board offline after the first visit.
- **A seeded demo board** at `/b/demo` — title, hand-drawn underline, three
  filled flow boxes, arrows, and notes — so the first open is not a blank page.

Not yet: real-time collaboration, accounts, cloud sync, image upload, and arrow
binding. Those are the next phases in
[`docs/superpowers/specs/2026-10-31-penpaper-design.md`](docs/superpowers/specs/2026-10-31-penpaper-design.md).
The canvas already uses the element model and tombstone semantics those phases
require.

## Stack

| Layer | Choice |
| --- | --- |
| App shell | Next.js 16 (App Router), React 19.3, TypeScript 7 |
| Canvas | `@penpaper/engine`, framework-agnostic TypeScript |
| Sketch geometry | Rough.js 4.6 |
| Pen strokes | Perfect Freehand 1.2 |
| Chrome | `@penpaper/ui`, plain CSS with the measured Excalidraw tokens |
| Metadata state | Zustand 5.0 |
| Device persistence | IndexedDB via `idb` 8.0 |
| Tests | Vitest 5 (unit), Playwright 1.64 (browser) |
| Host | Render free web service, no card |

## Run it

```bash
pnpm install
pnpm --filter web dev          # http://localhost:3000/b/demo
```

`/b/local` is the personal board; `/b/demo` opens with a small diagram the first
time and then behaves like any other local board.

Use `localhost`, not `127.0.0.1`: Next's dev-server cross-origin rules treat the
two as different origins and hydration silently stops.

```bash
pnpm -r typecheck
pnpm -r test                    # engine unit tests + storage/store tests
pnpm --filter web build
pnpm --filter web start         # production server on :3000
pnpm --filter web check:bundle  # board-route gzip budget
```

Browser tests:

```bash
pnpm --filter web e2e                          # development server
$env:E2E_PRODUCTION="1"; pnpm --filter web e2e # production build, includes offline PWA
```

On macOS/Linux the second line is `E2E_PRODUCTION=1 pnpm --filter web e2e`.
The offline test is skipped in development because Turbopack rehashes its HMR
client chunk between server starts; a production bundle is the honest target.

## Measured numbers

Recorded on the Asus TUF F15 (Windows 11, Chromium, 1440 × 900):

| Metric | Result | Gate |
| --- | --- | --- |
| Engine unit tests | 167 passing | all green |
| Web unit tests | 17 passing | all green |
| Browser tests | 33 passing | all green |
| Median renderer frame body, 1,000 mixed shapes | 7.3–8.4 ms production | ≤ 16 ms |
| Board route transfer, gzip | 169.4 KiB JS + CSS | ≤ 220 kB |

The frame measurement is the renderer's own body (cull, layout, paint commands),
not `requestAnimationFrame` deltas, which are clamped to the display refresh rate
and cannot show headroom. The bundle gate parses Turbopack's build manifests and
excludes `nomodule` polyfills that modern browsers never download.

## Deploying

The app is a standard Node server (`next build` + `next start`), which is what
Render's free tier runs. No Vercel-specific APIs are used.

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint** and select the repository. The included
   [`render.yaml`](render.yaml) creates a free web service with the right build
   and start commands.
3. Open `/b/demo` on each device. Android Chrome and desktop browsers offer
   **Install app**; the manifest and icons are already in place.

The free instance sleeps after 15 minutes of inactivity and takes ~60 s to wake.
The board itself renders from IndexedDB before any network work, so a sleeping
server is only a cold start, not data loss. A scheduled warm-up restricted to
08:00–24:00 IST keeps the instance awake during waking hours at roughly 500 of
the 750 free instance-hours per month; see
[`.github/workflows/warm.yml`](.github/workflows/warm.yml). Set the repository
variable `PENPAPER_URL` to enable it.

### ₹0 constraints

The project is built to stay free without a card: Render free (512 MB, 0.1 CPU,
WebSockets, 750 instance-hours), no paid object storage, no managed database in
Phase 1, and no expiring trial. Image upload was deferred instead of adding a
storage bill. Collaboration in Phase 3 keeps the same Node process and adds a
free Postgres instance only if the host's free tier still satisfies that rule.

## Devices

| Device | Status |
| --- | --- |
| Asus TUF F15 (Windows, mouse/trackpad) | Used for every recorded measurement |
| Poco F6 (Android, touch) | Layout, touch targets, and text editing verified in emulation; device pass pending |
| Xiaomi Pad 7 + Focus Pen | Pen path and palm rejection implemented; device pass pending |
| iPhone / iPad + Apple Pencil | Targeted, not verified |

Pen input uses Pointer Events with pressure and a palm-rejection heuristic; it
does not rely on Apple-only APIs.

## Architecture

`apps/web` is a thin React shell. `packages/engine` owns the scene, camera,
spatial index, renderer, input state machine, selection, and history. No element
data is copied into React state, so a board with thousands of shapes does not
produce thousands of renders while drawing.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data flow, the
transactional history model, the service-worker strategy, and the deployment
decision log.

## License

Private project; no license granted.
