# PenPaper architecture

This document describes PenPaper as built: the offline canvas, optional Google
Drive sync, accounts, share links, and live rooms. It is deliberately specific
about the seams that later phases will lean on, and about the decisions that are
easy to undo accidentally.

## Package layout

```
apps/web              Next.js App Router shell
  app/                the launcher at `/`: last notepad, or a one-time chooser
  app/b/[id]          one board per route; `?share=<token>` carries an invitation
  app/s/[token]       a share link, resolved server-side then redirected to the board
  app/api/            accounts, boards, share links, room token (Node runtime)
  server/             one Node process: Next + Socket.IO (`main.mjs`, `collab.mjs`)
  components/         Launcher, BoardLoader, BoardScreen, BoardChrome, BoardSurface,
                      TextEditorOverlay, AccountPanel, ShareDialog, PeerCursors
  lib/storage.ts      IndexedDB scene + notepad index stores (idb)
  lib/library.ts      notepad list model, demo seed, relative times
  lib/collab/         account store, API client, durable board sync, Yjs session
  lib/server/         Postgres schema, auth, roles, share tokens, room JWT
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
4. **Overlays** — the selection silhouette (box, ellipse, or the polygon's own
   vertices) and its handles, plus the marquee, in screen space after the camera
   transform is popped. Multi-selection keeps a dashed group box.
5. **Effects** — the laser trail and the eraser's ring, trail, and departing
   ghosts. They paint last so they sit on top, ghosts paint inside the camera
   transform so they stay glued to the paper, and `toDataUrl()` drops all of
   them so an export never contains a gesture.

`render()` returns immediately when no dirty flag was set. Pointer moves mark
the frame dirty; an idle board does no work. While a trail is fading there are
no further pointer events, so `BoardScreen` keeps requesting frames and marks
the renderer dirty until `effectsActive()` says both the laser and the eraser
have finished.

Rough.js is used as a *geometry generator*, never as a canvas renderer. The
engine caches drawables by type, size, seed, and style. Position and rotation
are applied as canvas transforms, so dragging a shape never regenerates its
wobble. The cache holds 4,096 entries and evicts the oldest 256 at capacity; the
old "clear everything at 512" behaviour made a 1,000-shape board regenerate its
first shapes on every frame.

## The element model

`Element` in `packages/shared/src/elements.ts` is one flat interface, not a
discriminated union:

- Collaboration maps one-to-one onto a `Y.Map<Element>` keyed by id; the flat
  shape means the next step (field-level merge) does not need a new serializer.
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
     | lasering
```

Pinch and multi-pointer gestures are arbitrated before the FSM sees them. A
pinch that begins as a stray stroke cancels that stroke. Palm rejection ignores
synthetic mouse events near a recently seen pen, and pen events win over touch.

Two rules keep the FSM from fighting the person using it:

- A selection handle outranks an armed creation tool. Drawing leaves the new
  shape selected while the shape tool is still armed, so grabbing a corner is
  "make it bigger", not "draw another one". Switching to the selection tool is
  never required to adjust what was just drawn.
- A non-primary button never reaches the tool. Right-clicking a handle adjusts
  the shape; right-clicking empty canvas does not leave stray ink.

The laser is a pointer, not a tool in the scene: its samples live on the
controller in a capped ring (320 points, 2 px minimum step, 850 ms fade), never
in `Scene`, never in history, never in a saved board. Changing tools clears it
so a trail can never bleed into ink.

The eraser is the same idea applied to deletion. A press tombstones the hit
element immediately (one undo step), but the controller keeps a copy taken
before the tombstone so the renderer can shrink and fade it out over 220 ms.
The ring is an 11 px screen-space circle; a soft trail is recorded only while
pressed (160 points, 2 px step) and fades over 320 ms. The hit path is sampled
at half the pick tolerance, so a fast flick erases continuously instead of
leaving a dotted line of survivors between pointer events. Hovering moves the
ring without leaving a trail, and none of this reaches the scene, history, a
saved board, or an export.

Selection handles are anchored per shape, not per bounding box
(`selection/handles.ts`). Rectangles, lines, arrows, text, and freehand keep the
eight-handle grid because their geometry is a box; diamonds and ellipses use
the four cardinal extremes; triangles, hexagons, and stars place one handle on
each outer vertex, with a star showing only its five tips. Each anchor is still
mapped to one of the nine resize directions, so `resizeElement` has a single
code path. `selection-overlay.ts` traces the matching silhouette — an ellipse
for ellipses, the shared polygon vertex table for polygons — so a handle never
floats in empty paper.

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
- **Toolbar** — the active tool, mirrored from `BoardScreen`. Six geometry
  shapes (rectangle, diamond, ellipse, triangle, hexagon, star) live behind one
  dock button and open in a two-column palette; the palette is portal-rendered
  and positioned in viewport space, beside the vertical desktop dock and above
  the horizontal phone dock, because the dock clips overflow on narrow screens.
  Adding another polygon costs a vertex table entry, not a dock slot.
- **Style panel** — `PropertiesPanel` in a right rail from 768 px up; a small
  chevron tab on the rail's left edge collapses it to the screen edge and back.
  Below that, the palette button in the top-left island drops a `StylePopover`:
  a content-sized card anchored under the icon and dismissed by any tap
  outside it. It edits one of two targets: the selected elements, or the style
  defaults stamped onto the next element the active tool creates.
  `InputController.setStyle()` holds that default; the panel receives a
  zero-sized preview element built from it, so the same form code serves both
  cases without a second component.
- **`AppMenu`** — the hamburger popover: the PenPaper account, the Google Drive
  state, the live-room state with Share/read-only, the notepad list (open,
  rename, delete, and per-notepad sync), undo/redo, theme, paper colour, layout,
  PNG export, and reset. Appearance actions keep the popover open so themes can
  be compared; one-shot and destructive actions close it. The list is a second
  view inside the same popover, not a route: switching notepads is a one-tap
  move mid-drawing, and renaming or deleting one never costs a navigation away
  from the canvas. A viewer sees the same menu without rename, delete, Drive,
  or share controls.

The island and its popover are siblings, not nested: a `backdrop-filter`
ancestor creates a backdrop root, and a descendant blur would then sample that
root (nothing) instead of the canvas. Keeping them siblings is what preserves
the glass material over the drawing.

That material is one shared layer in `ui.css`, not a per-component style: a
translucent tint, a saturating backdrop blur, a specular sheen along the top
edge, a hairline rim, and a depth shadow. The tokens live in `globals.css` so
light and dark boards stay in step, and `prefers-reduced-transparency` (or a
missing `backdrop-filter`) falls back to a solid island. Motion is shared too:
`pp-glass-in` (220 ms spring) and `pp-glass-out` (160 ms ease-out). The menu,
shape palette, and style popover stay mounted for the 180 ms exit and then
unmount, so closing is a surface leaving rather than a node vanishing between
frames. Their transform origin points at the button or dock item that opened
them, which makes the same animation feel local to each control.

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
locally, and — when signed in or connected to Drive — when the account or Drive
still has it. A stale id is cleared rather than followed, so a deleted notepad
never opens as a blank board under a dead id. Only a device that has never
opened one, or whose last one is gone, sees the chooser: recent notepads as rows
on paper, a New notepad button, and optional Connect Drive / account actions.

A share link is a short address, not a second app. `/s/<token>` resolves the
token on the server and redirects to `/b/<id>?share=<token>`. `BoardLoader`
resolves that invitation before mounting the canvas, so a viewer never gets a
writable first frame; an expired or revoked link gets a card with a fresh-link
hint. The API surface is:

| Route | Purpose |
| --- | --- |
| `POST /api/auth/google`, `sign-out` | Google access token, then PenPaper's session cookie |
| `GET /api/auth/me` | who is here, and whether accounts/rooms are configured |
| `GET/POST /api/boards` | the account's library; register a device notepad |
| `GET/PUT/DELETE /api/boards/<id>` | one snapshot, its role, its title |
| `POST /api/boards/<id>/share` | mint (or replace) a live link for a role |
| `POST /api/boards/<id>/collab` | five-minute room token |
| `GET /api/share/<token>` | resolve a link for programmatic use |

There is no separate management route. The hamburger's notepad list carries
open, rename (inline input), delete (one arming tap, then Delete), and — with
auto-sync off — a per-notepad Sync / Remove from Drive action. The root menu
holds the All notepads / Choose switch and the Share / live-room row. Rename
writes the device card, queues the Drive file rename, and sends the new title to
the account; delete trashes the Drive file, removes the account copy, and clears
`lastBoardId` when it was the remembered one.

`lastBoardId` is a device preference (`rememberBoard` on board mount,
`forgetBoard` on delete) and is validated against the same id alphabet the
route accepts. Two devices signed into one account may sit in different
notepads; that is correct, not a conflict.

## Persistence and hydration

`BoardLoader` reads IndexedDB **before** mounting the canvas. `undefined` means
"still reading" and renders a skeleton; `null` means "nothing saved" and mounts
an empty board (or, for a share link, waits for the server invitation first).
Mounting first and pouring elements in later is the blank-flash bug local-first
apps are prone to.

The device snapshot is:

```ts
{ version: 1, elements: Element[], camera: Camera, savedAt: number }
```

A share link is the one case that waits for the network: a viewer must not get a
writable first frame, and an expired link should say so instead of mounting a
board that cannot save. The loader pulls the server snapshot, merges it into the
device copy by `updatedAt`, writes the result back to IndexedDB, and passes the
resolved role to `BoardScreen`. A regular board does the same merge after the
first paint, so the canvas is never blocked on the account either.

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

**No server for Drive.** The browser uses Google Identity Services' token
model: a popup returns an access token valid for about an hour. The token lives
in `sessionStorage`, so it dies with the tab; the account name and picture live
in `localStorage` so the board menu can show who is connected. A returning tab
renews it with `prompt=none`, so the connection comes back without a click, and
only a revoked grant falls back to a Connect button. There is no client secret,
no refresh token, and no Drive traffic through PenPaper's server; the account
database described above is separate and optional. The only Drive configuration
is the public `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

**Scope.** `drive.file` plus `openid email profile`. One consent asks for all
three, so signing in connects Drive in the same popup. `drive.file` is
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

## Accounts, sharing, and live collaboration

Everything below is optional and layered on top of the same local-first board.
The canvas never waits for any of it: `BoardLoader` hydrates IndexedDB first,
`BoardScreen` mounts, and the account and room work happen after the first
paint. With no `DATABASE_URL` the API reports `configured: false` and none of
this code runs.

### One Node process, three jobs

`server/main.mjs` creates one HTTP server, hands requests to Next, and attaches
Socket.IO to the same server for `/api/collab`. `pnpm dev` and `pnpm start` both
run it (`--prod` sets `NODE_ENV` before Next is imported, because Windows cannot
spell `NODE_ENV=production` in a script). Render's free plan gives 750
instance-hours to one service; a second realtime service would halve that, so
the room service is not separate.

The room process never touches Postgres. The Next routes mint a five-minute
HS256 JWT (`PENPAPER_SECRET`, `jose`) carrying board, user, role, name, and
colour; the socket verifies the signature and expiry and trusts nothing else
from the client. Authorization therefore lives in one place — the route that
already knows the session or the share token — while the hot path stays a
signature check.

### Accounts

Google is the only way in, and there is no password anywhere in the system.

- One consent does both jobs. Google's token client opens a single popup asking
  for `openid email profile` and `drive.file`, and returns an access token. The
  account and the Drive connection therefore arrive together, and a returning
  tab renews the Drive half silently with `prompt=none`.
- `/api/auth/google` asks Google's `tokeninfo` endpoint what the token means,
  then checks the audience (the public client id), the subject, and a verified
  email. No client secret, no code exchange, and no JWT keys to cache. Rejections
  are a single 401 sentence, because every failure means the same thing to the
  person in front of the screen.
- The user row is keyed by Google's stable `sub`, so changing a Google address
  keeps the library. A row created before Google-only sign-in is adopted when
  the verified address matches, then the password column is dropped.
- Sessions are random 32-byte tokens stored only as SHA-256 hashes, in an
  `httpOnly`, `SameSite=Lax`, `Secure`-in-production cookie with a 30-day
  expiry. A stolen database row does not become a usable cookie.
- `currentUser()` reads the cookie, hashes it, and joins the session to the
  user. Every protected route calls it; components never see a token.
- Rate limits are per-IP and advisory, keyed on `x-forwarded-for` when Render
  supplies it.

The client id must list the site's origin under **Authorized JavaScript
origins** in Google Cloud Console. That allowlist is what lets Google's button
return a token; a wrong origin shows as "the given origin is not allowed" in the
console and nowhere else, which is why the deployment notes call it out.

A Neon project suspends when idle. The connection pool is deliberately small
(one process, 0.1 CPU) and the schema creates itself with `create table if not
exists` on first use, so there is no migration step and no build-time database.
`/api/auth/me` treats a database error as "signed out" instead of failing every
page that asks.

### Boards, roles, and share links

A board row stores owner, title, a JSON snapshot, and a monotonically increasing
`seq`. The role is always computed server-side:

| Caller | Role |
| --- | --- |
| The owner's session | `owner` |
| A valid share token for the board | the token's role (`editor` or `viewer`) |
| Anyone else | none — 404, not 403, so ids are not enumerable |

The same rule runs on REST and on socket-token minting. `PUT /api/boards/<id>`
returns 403 for a viewer token and 404 for an anonymous caller; the live room
refuses a viewer's `update` frames too, so a patched client cannot write.

Share links are live, not one-shot. There is one active link per board and role;
creating another replaces the previous one, which is how "revoke" works. The raw
token is generated with 32 random bytes, returned once, and stored as a SHA-256
hash. `/s/<token>` resolves it server-side and redirects to
`/b/<id>?share=<token>`; the token then travels on every read, write, and room
token request, so a reload keeps working and the resolver is not on the drawing
path. An expired link, an unknown token, and a database outage get distinct
cards rather than a generic 500.

Opening a board with an owner's session registers it with `ensureServerBoard`
using the id already in the address bar, so every link minted before sign-in
stays valid. A 409 there means another account already uses that id; the device
keeps drawing locally but does not join that board's room.

### Durable sync and the live room are separate

Two paths, on purpose:

- **Durable:** a 1.5 s debounced `PUT` writes the whole merged scene (live
  elements only) to Postgres, plus a flush on `pagehide` and on tab hide. A
  whole snapshot, not a delta, because Postgres already holds the materialised
  scene and every reader can consume it without replay.
- **Live:** Yjs updates over Socket.IO while people are present, throttled to
  one push per 100 ms during a stroke. The engine keeps the in-progress element
  in the scene, so peers watch it grow rather than waiting for pointer-up.

The durable path is the source of truth across devices; the room is a fast
cache that disappears when it empties. Rooms seed from the first client's full
local document, keep a 30 s grace period after the last peer leaves (so a
refresh or a tunnel does not lose the document), cap at 32 peers and 500 rooms,
and drop an idle room after 30 s.

### The Yjs model

One `Y.Map<Element>` named `elements`, keyed by element id. That is the smallest
unit that makes the merge promise honest: two people drawing different shapes
never conflict, and two people dragging the same shape resolve to the copy with
the newer `updatedAt`. The element model is already flat and field-mergeable, so
a future field-level CRDT would replace the map values, not the transport.

Two documents are kept in the client session:

- `local` is what this tab believes (the tab's Yjs replica).
- `remote` mirrors what the room has sent.

The initial exchange is `sync-request` → `sync`, then both sides send the
difference between state vectors with `Y.encodeStateAsUpdate(doc, stateVector)`.
That is the standard two-way sync and it is what makes reconnecting after a
tunnel carry everything the room missed, not just the last stroke.

**Reconciliation after applying a remote update.** Yjs resolves concurrent
writes by client id, not by `updatedAt`. A shape drawn offline during a tunnel
could therefore lose to an older room copy simply because the other client wrote
later in CRDT time. After applying a remote update, the session compares each
incoming element with the scene's copy and, where the local copy is newer,
writes it back into the map and flushes the correction. The room converges on
the newer drawing rather than on the newer client.

Deletions travel as tombstones. The scene keeps `isDeleted` elements, and the
live push sends `scene.snapshot()` (tombstones included) so a peer that was
offline when a shape was erased does not bring it back on reconnect. The
durable snapshot still contains only live elements.

`BoardScreen` adopts remote elements one at a time with `scene.restore()`, never
by replacing the scene: the user may be mid-stroke. Restoring the incoming
object — already stamped — avoids re-stamping it and starting an update
ping-pong. Selection and pointer position are presence, not drawing, and are
emitted separately and throttled.

### Presence

The socket roster includes every peer, including this tab. The session filters
its own socket id using `you` from the ready message, so a pointer is never drawn
twice. Peers are rendered as screen-space cursors over the canvas, positioned
from the camera on every animation frame rather than mirrored into React state,
so panning moves other people's pointers without re-rendering the chrome. The
menu's head count is `peers.length + 1` — this tab is a person too.

### Read-only is a mode, not a disabled button

A viewer opens with the hand tool, gets no toolbar, no history island, no style
panel, no reset, and no rename/delete/Drive actions. Keyboard shortcuts return
early. `changeTool` refuses anything but `hand` for a viewer, so a shortcut or a
stale tool cannot arm a pen. The text overlay is not mounted. The server still
refuses writes on both paths: hiding controls is courtesy, the 403 is the rule.

### Failure is still local

A failed room connection leaves `data-live="offline"` and the board keeps
drawing and saving to IndexedDB. A failed durable push is retried on the next
debounce and flushed when the tab hides; it never throws into the canvas. A
share link that cannot be resolved because the network is down says "could not
reach" and offers a retry, rather than pretending the link is invalid.

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

The worker doubles as the update channel. A tab that was already controlled
keeps the JavaScript it loaded with, so a shipped menu change would otherwise
stay invisible until a manual hard refresh. `ServiceWorkerRegistrar` asks for a
new worker whenever the page becomes visible; when one takes over, the page is
marked stale and reloads the next time it is hidden, so the swap never lands
mid-stroke. Bumping `VERSION` in `sw.js` also deletes the previous release's
caches on activate.

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

All of it ships as one Node process:

```
pnpm install --frozen-lockfile
pnpm --filter web build
pnpm --filter web start        # honors PORT
```

`render.yaml` describes a free Render web service (no card, WebSockets, 750
instance-hours) and declares `DATABASE_URL` and `PENPAPER_SECRET` as
dashboard-set secrets, with `NEXT_PUBLIC_GOOGLE_CLIENT_ID` optional. Socket.IO
upgrades share the server with Next, so live rooms cost no second service.
Postgres is Neon's free tier; the schema is created by the first request, so the
build never needs the database. With none of these set, the deployment still
builds and runs as the local-first notepad. The free instance sleeps after 15
minutes; `warm.yml` pings it every 10 minutes between 02:30 and 18:30 UTC
(08:00–24:00 IST), which uses about 500 of the 750 hours. The app renders local
content before any network call, so a sleeping instance never blocks a returning
user's board.

## Testing strategy

- **Engine unit tests** cover scene semantics, fractional indices, camera math,
  bounds, quadtree, hit testing, transforms, history, serialization, text
  layout, rendering primitives, and the rough cache.
- **Web unit tests** cover IndexedDB persistence and the notepad index, the Zustand
  metadata store, preferences (including the remembered notepad), Drive file
  naming and per-element merge, the reconciler against a mocked Drive with a
  real IndexedDB — pull, merge, save, upload order, coalescing, and recovery
  from a file deleted in Drive — and the shelf's three-way merge (device, Drive,
  account) including roles and non-duplicated rows.
- **Playwright** covers the seams that only a real browser can prove: the
  launcher (fresh device, remembered notepad, deleted-last fallback), the menu's
  account block and notepad list (new, rename, delete, 44 px row actions), the
  demo seed and the Drive-off hint, responsive chrome, a drag as one undo step,
  a style chosen before any element exists, theme and paper changes verified in
  canvas pixels, autosave surviving reload, board isolation, camera restoration,
  text overlay focus/IME-ish behaviour, the 1,000-element frame budget,
  manifest/icons, and the offline shell in a production build.

The live path was verified end to end against Neon with two real browsers: the
owner draws, an editor link joins and sees the stroke, draws back, and the owner
sees it; peer cursors appear with the self filtered; a viewer link opens with no
toolbar or history and cannot draw; both reload with the merged snapshot; and a
link minted from the Share dialog opens. That check is currently a manual
script, because it needs a real database and secret; the protocol module, the
session's state-vector and `updatedAt` reconciliation, and the role guards are
the next candidates for automated tests.



Device automation for the Poco F6 and Xiaomi Pad 7 is still a manual pass. iOS
and Apple Pencil remain targeted but unverified.
