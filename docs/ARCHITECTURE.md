# PenPaper architecture

This document describes Phase 1 as built. It is deliberately specific about the
seams that later phases (accounts, cloud boards, real-time collaboration) will
lean on, and about the decisions that are easy to undo accidentally.

## Package layout

```
apps/web              Next.js App Router shell
  app/                the launcher at `/`: last notepad, or a one-time chooser
  app/b/[id]          one board per route
  components/         Launcher, BoardLoader, BoardScreen, BoardChrome, BoardSurface, TextEditorOverlay
  lib/storage.ts      IndexedDB scene + notepad index stores (idb)
  lib/library.ts      notepad list model, demo seed, relative times
  lib/drive/          optional Google Drive sync (auth, REST, merge, reconcile)
  lib/preferences.ts  validated theme/paper/layout/style/auto-sync defaults (localStorage)
  store/board-store.ts  Zustand metadata (status, element count, savedAt)
  public/sw.js        offline shell service worker
  e2e/                Playwright specs
packages/shared       Element model, defaults, fractional index helpers
packages/engine       framework-agnostic canvas engine
  scene/              Scene, factory, paint order
  math/               camera, bounds, quadtree, hit testing, transforms
  render/             layered renderer, rough cache, shapes, themes
  input/              FSM, gesture arbiter, palm rejection, controller
  history/            transaction history and commands
  text/               wrapping and measurement
  serialize.ts        versioned board JSON
packages/ui           toolbar, properties panel, app menu, style popover, CSS tokens
```

The engine has no React, Next, or module-scope `window` access. Its runtime
dependencies are only `@penpaper/shared`, `roughjs`, and `perfect-freehand`.
That is what makes it testable under Node and reusable in a future worker or
desktop shell.

## One frame

React renders exactly one `<canvas>` and a set of HTML islands (toolbar,
properties, text editor). Everything inside the canvas is painted by the engine:

1. **Background** — the theme fill, or the paper colour chosen in the menu.
2. **Grid** — plain (nothing), dotted, or boxed paper, drawn once into an
   offscreen canvas and blitted until the camera, theme, layout, or paper changes.
   Below ~6 px spacing the grid is skipped rather than drawn as a grey haze.
3. **Elements** — `Scene.ordered()` returns live elements sorted by fractional
   `index`. A quadtree-backed view bounds check culls anything off screen before
   `drawElement` runs.
4. **Overlays** — selection handles and marquee in screen space, after the
   camera transform is popped.

`render()` returns immediately when no dirty flag was set. Pointer moves mark
the frame dirty; an idle board does no work.

Rough.js is used as a *geometry generator*, never as a canvas renderer. The
engine caches drawables by type, size, seed, and style. Position and rotation
are applied as canvas transforms, so dragging a shape never regenerates its
wobble. The cache holds 4,096 entries and evicts the oldest 256 at capacity; the
old "clear everything at 512" behaviour made a 1,000-shape board regenerate its
first shapes on every frame.

## The element model

`Element` in `packages/shared/src/elements.ts` is one flat interface, not a
discriminated union:

- Field-level collaboration maps one-to-one onto a `Y.Map`; two people editing
  colour and position of the same shape never clobber each other.
- Persistence is JSON in one column, with no per-type serializer.
- Renderers read fields in the hot path without narrowing.

Every type-specific field is present on every element and ignored where it does
not apply. New fields can be added with a schema default, and the deserializer
fills them in for older snapshots.

Deletion is a tombstone (`isDeleted: true`), never `Map.delete`. Tombstones make
undo cheap and stop a stale replica from resurrecting an element after a merge.
Serialization writes only live elements; tombstones matter during a session and
during collaboration, not in a device snapshot.

Paint order is a fractional index string. Reordering is a field update, not an
array splice, which is another property the collaborative model needs.

## Input and history

`InputController` owns the finite state machine:

```
idle → drawing | dragging | resizing | rotating | selecting | erasing | panning
```

Pinch and multi-pointer gestures are arbitrated before the FSM sees them. A
pinch that begins as a stray stroke cancels that stroke. Palm rejection ignores
synthetic mouse events near a recently seen pen, and pen events win over touch.

History is transaction-based, not command-per-event:

- `begin(label)` snapshots the scene map (shallow; elements are immutable
  values).
- Pointer moves mutate the scene normally, producing fresh objects.
- `commit()` diffs the snapshot by reference and keeps only changed elements.
- An empty diff is discarded, so a click that moved nothing adds no undo step.
- A new command clears redo; the stack is capped at 100 commands.

The result: a 50-move drag is one undo step, and redo restores geometry without
firing thousands of commands. History deliberately does not restore selection;
the shell re-selects through the controller after undo/redo.

## React ↔ engine seam

`BoardScreen` is the only component that knows both worlds. It owns:

- the canvas and its renderer,
- the current tool (mirrored into React for the toolbar),
- a copy of the selected elements (for the properties panel),
- the text overlay's editing id.

It owns no element array. The engine's scene is the single source of truth.
Callbacks (`onSceneChange`, `onSelectionChange`, `onCameraChange`) update small
metadata, mark frames dirty, and schedule persistence. This is why a board with
thousands of shapes does not re-render React on every pointer move.

The text tool is the exception that proves the rule: the browser textarea owns
focus, caret, selection, and IME. The scene is updated once, in one transaction,
when editing ends. An element committed empty is deleted. Focus is requested on
the next animation frame because the originating mousedown would otherwise steal
it back and commit an empty value immediately. The textarea is never smaller
than 16 px, which stops iOS from zooming the page on focus, and it lifts with
`visualViewport` so the Android keyboard does not cover it.

### Chrome ownership

`BoardChrome` renders only floating islands over the canvas — no title bar and
no permanent wordmark, the same restraint as excalidraw.com. It owns no board
state:

- **History** — undo and redo in a two-button island, bottom-left on desktop
  and top-right on small screens, sized to match the menu island.
- **Toolbar** — the active tool, mirrored from `BoardScreen`.
- **Style panel** — `PropertiesPanel` in a right rail from 768 px up; a small
  chevron tab on the rail's left edge collapses it to the screen edge and back.
  Below that, the palette button in the top-left island drops a `StylePopover`:
  a content-sized card anchored under the icon and dismissed by any tap
  outside it. It edits one of two targets: the selected elements, or the style
  defaults stamped onto the next element the active tool creates.
  `InputController.setStyle()` holds that default; the panel receives a
  zero-sized preview element built from it, so the same form code serves both
  cases without a second component.
- **`AppMenu`** — the hamburger popover: the account and Drive state, the
  notepad list (open, rename, delete, and per-notepad sync), undo/redo, theme,
  paper colour, layout, PNG export, and reset. Appearance actions keep the
  popover open so themes can be compared; one-shot and destructive actions
  close it. The list is a second view inside the same popover, not a route:
  switching notepads is a one-tap move mid-drawing, and renaming or deleting one
  never costs a navigation away from the canvas.

The island and its popover are siblings, not nested: a `backdrop-filter`
ancestor creates a backdrop root, and a descendant blur would then sample that
root (nothing) instead of the canvas. Keeping them siblings is what preserves
the glass material over the drawing.

Choosing a tool other than `select` or `hand` clears the selection, so the
panel's target follows intent: after tapping "rectangle" the panel means "the
rectangle I am about to draw", not "the shape I had selected".

### Paint-time ink mapping

A board drawn in light mode stores near-black ink (`#1e1e1e`). Painting that
unchanged on the dark theme would erase every stroke. `drawElement` therefore
maps only the two default inks to the active theme's stroke colour *while
painting*; the stored element, the IndexedDB snapshot, and any future
collaboration payload keep their original value. Colours the user picked
deliberately are never rewritten.

The default style follows the same rule: switching theme moves the default pen
between `#1e1e1e` and `#e3e3e8` only while it is still a default ink.

## Routes and the launcher

`/` is a hand-off, not a catalogue. `Launcher` reads `lastBoardId` from device
preferences and `router.replace`s to `/b/<id>` when that notepad still exists
locally, and — with an account connected — when Drive still has it. A stale id
is cleared rather than followed, so a deleted notepad never opens as a blank
board under a dead id. Only a device that has never opened one, or whose last
one is gone, sees the chooser: recent notepads as rows on paper, a New notepad
button, and an optional Connect Drive button.

There is no separate management route. The hamburger's notepad list carries
open, rename (inline input), delete (one arming tap, then Delete), and — with
auto-sync off — a per-notepad Sync / Remove from Drive action. The root menu
holds the All notepads / Choose switch. Rename writes the device card and queues
the Drive file rename on the next upload; delete trashes the file and clears
`lastBoardId` when it was the remembered one.

`lastBoardId` is a device preference (`rememberBoard` on board mount,
`forgetBoard` on delete) and is validated against the same id alphabet the
route accepts. Two devices signed into one account may sit in different
notepads; that is correct, not a conflict.

## Persistence and hydration

`BoardLoader` reads IndexedDB **before** mounting the canvas. `undefined` means
"still reading" and renders a skeleton; `null` means "nothing saved" and mounts
an empty board. Mounting first and pouring elements in later is the blank-flash
bug local-first apps are prone to.

The device snapshot is:

```ts
{ version: 1, elements: Element[], camera: Camera, savedAt: number }
```

`deserializeScene` validates and repairs. A malformed element is dropped, a
missing field gets the current factory default, and an unsupported version
fails loudly instead of rendering `NaN` geometry. Duplicate ids keep the first
copy.

Writes are debounced by 500 ms, flushed on `pagehide` and when the document
becomes hidden. IndexedDB failures downgrade the board to in-memory use and mark
the store `unavailable` rather than taking the canvas down.

Device preferences are separate from board content and live in `localStorage`
under `penpaper:prefs:v1`:

```ts
{ theme: "light" | "dark" | "system", background: string | null,
  layout: "none" | "dots" | "lines", style: StyleDefaults, autoSync: boolean,
  lastBoardId: string | null }
```

Theme, paper, layout, and the next-element style are device facts, not board
facts: they should follow a person across every board without being uploaded or
merged. `loadPreferences` normalises hand-edited or stale JSON field by field,
falling back to defaults rather than letting a bad colour reach the renderer.
A pre-paint inline script in `app/layout.tsx` resolves the theme before the
first frame, so a dark board never flashes white.

The canvas has no `localStorage`, so these values are pushed into the renderer
at startup and through `setTheme`, `setBackground`, and `setPattern` whenever
they change.

The launcher and the menu share `createNotepad`, so a second blank notepad is named
`Untitled notepad 2` rather than producing cards a person cannot tell apart. The
first run seeds one demo notepad, and `/b/demo` seeds the same diagram if opened
directly: text, freedraw, filled rectangles, and arrows, written before the
canvas mounts. After that first write it is an ordinary board, so edits,
renaming, and the camera persist and the demo is never injected over user work.
A `localStorage` flag stops a deleted demo from returning.

## Google Drive sync (optional)

Drive is a second copy, never the source of truth. The board is loaded from
IndexedDB before any network call; reconciliation runs after the first paint and
silently does nothing when no account is connected.

**No server.** The browser uses Google Identity Services' token model: a popup
returns an access token valid for about an hour. The token lives in
`sessionStorage`, so it dies with the tab; the account name and picture live in
`localStorage` so the board menu can show who is connected and reconnect in one
tap. There is no client secret, no refresh token, no backend, and no database.
The only configuration is the public `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

**Scope.** `drive.file` plus `openid email profile`. `drive.file` is
non-sensitive: the app sees the files it created, not the rest of the user's
Drive, and it does not trigger the restricted-scope security assessment.

**What travels.** One JSON document per notepad:

```ts
{ format: "penpaper.board", version: 1, boardId, title, savedAt, elements }
```

It is stored as `<title>.penpaper.json` in a visible `PenPaper` folder, tagged
with app-private properties (`penpaper=1`, `boardId`) so renaming the folder in
Drive does not strand the app. The camera is deliberately absent: a phone should
not inherit a laptop's zoom.

**The notepad index.** IndexedDB v2 keeps a separate `meta` store so the menu
lists titles and counts without reading every scene. Each card also records this
device's relationship to Drive: `driveFileId`, the last agreed `driveVersion`,
`syncedAt`, and `inLibrary`. Those fields describe the device, not the board, so
they are never uploaded. `listBoards()` backfills a card for boards written
before v2.

**Reconciliation order.** Pull, merge, write locally, then upload:

1. `files.get` the known file (or `files.list` by `boardId` on a new device).
2. If its `version` differs from the last agreed one, download and merge.
3. `mergeElements` unions by id and takes the newer `updatedAt` for a shared
   shape. Deletions are tombstones (`isDeleted`), so a newer deletion survives
   an older edit. Same person, different devices: per-element last-writer-wins
   is the honest promise; field-level CRDT merging belongs to the collab phase.
4. Save the merged scene locally, then upload one multipart document.
5. Record the new file id and version.

Uploading before pulling would overwrite whatever the other device wrote, which
is the lost-work case the feature exists to prevent. The reconciler is keyed by
board id, so two quick saves coalesce into one run. A trashed file clears its
stale id and is recreated in the folder rather than PATCHed forever.

`driveVersion` is advisory, not a lock: no `If-Match` precondition is used. The
only writers are the same account's devices, and the merge makes a lost race
non-destructive.

**Enablement.** `autoSync` (device preference, default on) syncs the whole
library. Turned off from the menu, only boards with `inLibrary` or a known file
id move, and each row in the notepad list grows a per-notepad Sync / Remove from
Drive action.

**Background sweep.** Opening a notepad reconciles that notepad after the first
paint; a library-wide pass runs about four seconds later, throttled to once per
five minutes per tab in `sessionStorage`. Work started on another device
therefore appears without any extra visit, and an ordinary reload does not spend
its first seconds on uploads.

**Failure is local failure.** The 1.2 s push debounce never throws into the
canvas; a failed push is reported in the sync store and the board stays on the
device. Hiding the tab flushes the queue, because a backgrounded tab is often
closed before its timer fires. A Drive file deleted while offline is remembered
in `localStorage` and trashed on the next connected sync, so a later pull cannot
resurrect a notepad the person deleted.

## Offline shell

`public/sw.js` is intentionally narrow:

- **Navigation:** network-first, falling back to the cached route, then to
  `/b/offline`. A Render cold start keeps the browser loading rather than
  showing a false "offline" page.
- **`/_next/static/*` and icons:** cache-first. These files are content-hashed
  or rarely change.
- **Manifest:** stale-while-revalidate.
- **Everything else** — RSC payloads (`?_rsc=`), API traffic, sockets — bypasses
  the worker. A cached client-navigation fragment can belong to another route,
  and collaboration must never see a stale response.

During install the worker fetches the rendered offline board once, stores it,
and caches every `/_next/static/...` URL named in its HTML. That extra step is
what makes the *first* visit offline-capable: the worker only starts controlling
after hydration, by which point every script has already loaded without passing
through it.

Registration is production-only by default, with `?sw=1` as a development
opt-in. This keeps `next dev` and the e2e suite away from yesterday's chunks.

## Performance budget

Two gates run in CI and locally:

- **Frame body:** `__seedPerfBoard(1000)` fills the scene with 1,000 mixed
  rectangles, ellipses, and diamonds across the viewport, then times 15 full
  renders and reports the median. The hook is compiled out of normal production
  builds and only enabled for `E2E_PRODUCTION=1`.
- **Bundle:** `pnpm --filter web check:bundle` reads Turbopack's
  `build-manifest.json` (root chunks) and the route's client-reference manifest
  (route JS and CSS), gzips each file, and fails above 220,000 bytes. Polyfills
  are excluded because modern browsers never download the `nomodule` bundle.

Both budgets are deliberately measured on the render path and the shipped bytes,
not on synthetic scores.

## Mobile decisions

- The board page never scrolls: `100dvh`, `overflow: hidden`, `overscroll-behavior:
  none`, and `touch-action: none` on the canvas. Otherwise iOS hands drags to
  the document.
- Coarse pointers get 44 px minimum targets; hit testing uses a 22 px radius for
  touch and 8 px for a mouse.
- The phone dock is horizontal; the desktop dock is vertical. The properties
  panel becomes a card under the palette button on small touch widths: a
  top-left popover, not a bottom slab. It has no drag handle, no close button,
  and no fixed height; any tap outside it, Escape, or a tool change dismisses
  it. From 768 px up the full panel sits on the right, with a chevron tab that
  collapses it to the screen edge and brings it back.
- The bottom edge holds the dock and nothing else. The old colour pill floated
  above it and covered another 54 px of canvas; the palette now lives beside the
  hamburger in the top-left island, so colours are still one tap away without a
  permanent second bar.
- A blank board opens with the pen selected on coarse pointers: "select" is a
  dead tap when there is nothing to select.

## Deployment

Phase 1 ships as one Node process:

```
pnpm install --frozen-lockfile
pnpm --filter web build
pnpm --filter web start        # honors PORT
```

`render.yaml` describes a free Render web service (no card, WebSockets, 750
instance-hours). `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is declared with `sync: false`,
so the Drive client id is set in the dashboard and the app still builds and runs
without it. The free instance sleeps after 15 minutes; `warm.yml` pings it
every 10 minutes between 02:30 and 18:30 UTC (08:00–24:00 IST), which uses about
500 of the 750 hours. The app renders local content before any network call, so
a sleeping instance never blocks a returning user's board.

Phase 3 adds a Node + Socket.IO service in the same repository (`services/`), a
free Postgres database, and Yjs updates over the existing element model. The
client already treats elements as field-mergeable and deletions as tombstones,
so that phase changes the transport, not the data model.

## Testing strategy

- **Engine unit tests** cover scene semantics, fractional indices, camera math,
  bounds, quadtree, hit testing, transforms, history, serialization, text
  layout, rendering primitives, and the rough cache.
- **Web unit tests** cover IndexedDB persistence and the notepad index, the Zustand
  metadata store, preferences (including the remembered notepad), Drive file
  naming and per-element merge, and the reconciler against a mocked Drive with a
  real IndexedDB — pull, merge, save, upload order, coalescing, and recovery
  from a file deleted in Drive.
- **Playwright** covers the seams that only a real browser can prove: the
  launcher (fresh device, remembered notepad, deleted-last fallback), the menu's
  account block and notepad list (new, rename, delete, 44 px row actions), the
  demo seed and the Drive-off hint, responsive chrome, a drag as one undo step,
  a style chosen before any element exists, theme and paper changes verified in
  canvas pixels, autosave surviving reload, board isolation, camera restoration,
  text overlay focus/IME-ish behaviour, the 1,000-element frame budget,
  manifest/icons, and the offline shell in a production build.

Device automation for the Poco F6 and Xiaomi Pad 7 is still a manual pass. iOS
and Apple Pencil remain targeted but unverified.
