# PenPaper — Design

**Date:** 2026-10-31
**Status:** Approved for planning
**Owner:** Rishabh

---

## 1. Intent

PenPaper is a browser whiteboard that feels like pen on paper. Anyone can sign up, create a board, sketch a diagram, and share it with a link. Two or more people can draw on the same board at the same time, from a phone in one hand and a laptop in the other.

It is also a portfolio artifact. A reviewer should be able to open the repo and see three things that are hard to fake: a canvas engine written from scratch, conflict-free multiplayer, and an interface that does not fall apart below 1024px.

**The core promise:** open the link, and within three seconds you are drawing — on whatever device you happen to be holding.

---

## 2. Goals

- **G1 — Zero-friction start.** Landing page → drawable canvas in under 3 seconds on a mid-tier phone over 4G, with no signup required for a scratch board.
- **G2 — Device-native feel.** Mouse and keyboard feel precise. Apple Pencil feels like ink. A thumb on a phone can draw, pan, and open properties without hunting.
- **G3 — Real collaboration.** ≥10 concurrent editors per board, live cursors, live selection, no lost edits, reconnect after a phone sleeps.
- **G4 — Never lose work.** Local-first: every stroke persists to IndexedDB immediately, syncs when the network allows, and survives a tab crash.
- **G5 — Demonstrably deployed.** Live on a real domain, with a health check, an error tracker, and a demo board pre-seeded with content.

---

## 3. Non-goals

- Native iOS/Android apps.
- Enterprise SSO, SCIM, audit logs.
- A plugin marketplace or scripting API.
- Video, voice, or comments (comments are a stretch goal, not launch).
- Pixel-for-pixel parity with Excalidraw's every tool and setting.
- Server-side rendering of board contents (boards are client-rendered, always).
- Billing. Free at launch, no plans, no paywall.

---

## 4. Anti-goals

These are failure modes. If any of these is true, the project has failed regardless of feature count.

1. **Page zoom steals the pinch.** On a phone, pinching the canvas zooms the browser instead of the board.
2. **Desktop-only.** It works beautifully at 1440px and is unusable on an iPhone.
3. **Jank on a real phone.** 100 elements and the frame rate collapses.
4. **Silent data loss.** A crash, a sleep, or a dropped connection costs a stroke.
5. **Ghost collaborators.** Cursors linger after someone closes the tab, or edits desync after reconnect.
6. **Demo graveyard.** The deployed link is down, cold, or shows an empty canvas when a recruiter clicks it.
7. **Feature soup.** Twenty half-working tools instead of eight that feel finished.

---

## 5. Constraints

| Constraint | Value |
|---|---|
| Team | One developer, part-time |
| Timeline | 12 weeks |
| Budget | ₹0/month forever. No card, no trial clock, no paid tier — if a host needs a payment method it is disqualified |
| Language | TypeScript everywhere |
| Browsers | Chrome/Edge/Firefox last 2; Safari 16.4+ (Next.js 16's own floor); iOS 16.4+; Android Chrome 120+ |
| Hosting | Vercel Hobby (app), Neon (Postgres), **Render free (Node + Socket.IO collab)**. **No object storage at launch** — R2 requires a payment method, so image uploads are out of scope |
| Licensing | MIT for the repo; Excalifont (OFL) bundled |

---

## 6. The device model

This section is the heart of the design. "Works on any device" is not a CSS afterthought — it is an input architecture, a layout system, and a performance policy.

### 6.1 One input pipeline

All input goes through **Pointer Events**. No separate mouse/touch/pen code paths.

- `pointerdown` → `setPointerCapture`.
- `pointermove` → use `getCoalescedEvents()` when the browser supports it (Apple Pencil fires at 120–240 Hz; coalesced events prevent dotted lines).
- `pointerType` distinguishes `mouse`, `pen`, `touch`.
- Pressure comes from `event.pressure`; tilt from `tiltX/tiltY`; `perfect-freehand` consumes both for width.

**Palm rejection.** The first `pointerdown` with `pointerType === "pen"` sets `penActiveUntil = now + 800ms`. Any `touch` pointer during that window is ignored for drawing and gesture handling. Every pen event extends the window. This is the single most important rule for tablet users — without it, a resting palm draws a fat diagonal line across the board.

**Gesture arbitration** (touch only):

| Gesture | Result |
|---|---|
| 1 finger on canvas, active tool = select/hand | Pan |
| 1 finger on canvas, active tool = draw | Draw a stroke |
| 2 fingers | Cancel any in-progress stroke, then pan + zoom together |
| 3 fingers | Undo preview (stretch goal, off by default) |
| Long-press 500ms on an element | Context menu |
| Double-tap on an element | Enter text editing |

Two-finger pinch must **cancel, not commit**, the stroke in progress. Committing a half-drawn squiggle whenever the user pinches is the most common touch bug in canvas apps.

**Wheel/trackpad:** `ctrl/cmd + wheel` zooms at cursor; plain wheel pans vertically; `shift + wheel` pans horizontally. This matches Figma and Excalidraw, so muscle memory transfers.

**Hover affordances** are gated behind `@media (hover: hover) and (pointer: fine)`. No hover-only affordances on touch devices.

### 6.2 Layout matrix

Three breakpoints, one component tree, different compositions.

| Region | Desktop ≥ 1024px | Tablet 768–1023px | Phone < 768px |
|---|---|---|---|
| Tool dock | Floating vertical, left, centered | Floating vertical, left, compact icons | Floating horizontal, bottom, scrollable |
| Properties | Right side panel (280px), always visible when selection exists | Bottom sheet, peek height 72px | Bottom sheet, peek 88px, drag to half/full |
| Top bar | Title + undo/redo + presence + Share | Title + presence + Share | Title (truncated) + avatar stack + menu |
| Zoom controls | Corner HUD | Corner HUD | Hidden — pinch only |
| Minimap | Yes | Yes, collapsible | No |
| Keyboard shortcuts | All | All (hardware keyboard) | None; all actions reachable by touch |
| Context menu | Right-click | Long-press | Long-press |
| Undo/redo | Top bar + ⌘Z | Top bar + ⌘Z | Buttons in the top bar |

**Bottom sheet** (tablet + phone) is a single reusable component with three snap points: `peek`, `half` (50dvh), `full` (90dvh). It is dismissible by swipe-down and by tapping the canvas. Content is the same properties panel component as desktop — one implementation, two containers.

**Touch targets** are ≥ 44×44 CSS px on any `(pointer: coarse)` device, with 8px spacing. Icon buttons inside the tool dock are 44px on touch and 36px on fine pointers.

**Canvas is always full-bleed.** The page never scrolls. `touch-action: none` on the canvas element only, so page zoom remains available everywhere else (accessibility requirement — do not set `user-scalable=no` globally).

### 6.3 Viewport and browser chrome

- Height uses `100dvh`, not `100vh`.
- All chrome respects `env(safe-area-inset-*)` for notches and home indicators.
- `overscroll-behavior: none` on `body` prevents pull-to-refresh killing a stroke.
- A `ResizeObserver` on the canvas host re-sizes the backing buffer when the iOS address bar collapses; zoom and scroll offsets are preserved so the drawing does not jump.
- `visualViewport` events handle the software keyboard: when a text element is being edited and the keyboard is open, the board scrolls that element into the visible area (top third, not centered, so the keyboard never covers it).

### 6.4 Text entry on every device

Canvas text cannot use a real `<textarea>` inline, so:

- A single hidden `<textarea>` is absolutely positioned over the text element, transparent, 16px font minimum (below 16px, iOS Safari zooms the page on focus).
- `compositionstart`/`compositionend` are respected so IME input (Japanese, Chinese, Korean, Vietnamese) works.
- On desktop, Enter inserts a newline, Escape commits. On mobile, Enter inserts a newline; the keyboard's Done key commits.
- Caret, selection, and double-click-to-select-word are handled by the real textarea — never reimplemented.

If this component is wrong, the app is unusable on phones. It gets built early and tested on a real iPhone.

### 6.5 Performance tiers

Detected once at startup from `navigator.hardwareConcurrency`, `navigator.deviceMemory`, `devicePixelRatio`, and `navigator.connection.saveData`:

| Tier | Typical device | Behaviour |
|---|---|---|
| A | Desktop, 8+ cores | DPR capped at 2, minimap on, grid on, shadows on, 60fps target |
| B | Tablet, 4–8 cores | DPR capped at 2, minimap collapsible, 60fps target |
| C | Phone, ≤4 cores or `deviceMemory ≤ 4` | DPR capped at 1.5, minimap off, grid off, rough.js drawables cached aggressively, 30fps floor |

**Dynamic downgrade:** the render loop measures a rolling median frame time. If median frame time exceeds 22ms for 60 consecutive frames, the engine drops one tier's worth of effects (disable shadows → disable grid → reduce DPR) for the session. It never upgrades mid-session (avoids oscillation).

### 6.6 Offline and installability

- PWA manifest, standalone display, maskable icons, `theme-color` per scheme.
- Service worker precaches the app shell and the Excalifont woff2.
- Boards are cached in IndexedDB (`idb` wrapper) as serialized element arrays plus pending Yjs updates.
- Offline edits queue; on reconnect they merge through Yjs — no conflict UI, ever.
- A slim "Offline — changes saved locally" pill appears in the top bar; it disappears on reconnect.
- `visibilitychange` → `hidden` flushes pending writes immediately (mobile browsers kill background tabs without warning).

### 6.7 Accessibility

- Full keyboard operation of the UI: tool selection (`v`, `h`, `r`, `o`, `d`, `a`, `l`, `p`, `t`, `e`), navigation, dialogs, and the properties panel.
- Visible focus rings on all controls, 2px, `--ring` token.
- `prefers-reduced-motion` disables cursor easing and sheet spring animations.
- `prefers-color-scheme` drives the default theme; manual override persists.
- **Known limitation, documented in the README:** the canvas is not screen-reader accessible. Text elements can be exported as JSON/Markdown via a "Copy as text" action, which is the accessibility escape hatch. Do not claim WCAG conformance.

---

## 7. Architecture

```
Browser
├── apps/web — Next.js 16 (App Router), Vercel
│   ├── marketing: /, /pricing (static)
│   ├── auth: /login, /signup
│   ├── dashboard: /boards
│   └── board: /b/[id]  → client-only canvas
│
├── packages/engine — pure TypeScript, zero React, zero DOM (except canvas 2D context)
│   ├── scene/       elements, z-order, groups, bounds
│   ├── render/      renderer, layers, rough cache, viewport culling
│   ├── input/       pointer FSM, gestures, keyboard
│   ├── math/        transforms, hit-testing, quadtree, snapping
│   └── history/     command stack
│
├── packages/shared — element types, zod schemas, color tokens
├── packages/ui — shadcn primitives, responsive shells
└── packages/db — Prisma schema + client, shared by the app and the collab service

Node services (Render free)
└── services/collab — Node.js + Socket.IO + Yjs, rooms per board,
    JWT handshake verification, snapshot writer straight to Postgres
```

The engine being framework-agnostic is deliberate: it is unit-testable in Node, it can be embedded in the marketing page as a live demo, and it is the part worth talking about in an interview.

### 7.0 Pinned versions (verified 2026-10-31)

| Package | Version | Note |
|---|---|---|
| next | 16.4.x | Turbopack is the default builder; `proxy.ts` replaces `middleware.ts` |
| react / react-dom | 19.3.x | App Router tracks React canary features |
| typescript | 7.0.x | Native compiler; if any tool lags, fall back to 5.9 — nothing in the design needs TS 7 |
| tailwindcss | 4.3.x | CSS-first config, no `tailwind.config.js` |
| yjs | 13.6.x | |
| socket.io / socket.io-client | 4.8.x | Transport for the collab service; polling fallback included |
| @socket.io/redis-adapter | 8.3.x | Scale-out only, not at launch |
| roughjs | 4.6.x | |
| perfect-freehand | 1.2.x | |
| zustand | 5.0.x | |
| better-auth | 1.7.x | |
| prisma / @prisma/client | 7.10.x | Rust-free client; **driver adapter (`@prisma/adapter-pg`) is mandatory**, `binaryTargets` no longer exists |
| zod | 4.6.x | |
| idb | 8.0.x | |
| vitest | 5.0.x | |
| @playwright/test | 1.64.x | |

Do not adopt `prisma@8` (release candidate at time of writing) — 7.10 is the stable line.

**Consequence for deployment:** because Prisma 7 is Rust-free, the old "build on Windows, deploy to Linux, get a query-engine error" trap is gone. The remaining cross-platform risk is native modules in the collab service, and there are none planned.

### 7.1 Engine internals

**Scene.** `Map<ElementId, Element>` plus a `string[]` of ids in z-order. Ordering uses **fractional indexing** (a lexicographic string key) so concurrent inserts never collide: Yjs merges two independently-chosen order keys without a lock.

**Render loop.** One `requestAnimationFrame` loop, running only when `dirty` is true. Three layers:

1. **Background** — solid colour, optional grid (redrawn only on pan/zoom).
2. **Static** — all elements that are not being interacted with. Cached to an `OffscreenCanvas` and blitted; invalidated only when an element changes or the viewport moves. If `OffscreenCanvas` is unavailable, the same code path renders to a second stacked `<canvas>`; the renderer behind a `StaticLayer` interface, so the fallback is one implementation swap, not a second renderer.
3. **Interactive** — the element(s) under an active drag, selection handles, collaborator cursors, snapping guides.

**Rough.js caching.** Each element owns a `drawable` regenerated only when its geometry/style hash changes. Regenerating every frame is the #1 cause of frame drops in sketchy-canvas apps.

**Viewport culling.** Only elements whose bounds intersect the viewport (plus 200px margin) are drawn.

**Hit testing.** A quadtree rebuilt lazily (max once per frame) over element bounds. Point queries walk the tree, then do exact shape tests in element-local coordinates. Needed so 5,000-element boards stay interactive.

**Interaction FSM.** `idle → panning | selecting | dragging | resizing | rotating | drawing | erasing | editingText`. Every transition is explicit and unit-tested. Illegal transitions throw in development.

**History.** Command objects with `apply`/`revert`, coalesced per-drag (a resize is one undo step, not 200).

### 7.2 Element model

```ts
type ElementType = "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "freedraw" | "text" | "image";

interface ElementBase {
  id: string;
  type: ElementType;
  x: number; y: number;          // scene coords, top-left of unrotated bounds
  width: number; height: number;
  angle: number;                 // radians
  strokeColor: string;
  backgroundColor: string;
  fillStyle: "hachure" | "cross-hatch" | "solid";
  strokeWidth: 1 | 2 | 4;
  strokeStyle: "solid" | "dashed" | "dotted";
  roughness: 0 | 1 | 2;          // architect / artist / cartoonist
  opacity: number;               // 0–100
  seed: number;                  // rough.js determinism
  index: string;                 // fractional z-order key
  groupIds: string[];
  isDeleted: boolean;
  version: number;               // bump on every local mutation
  updatedAt: number;
}

interface FreedrawElement extends ElementBase {
  points: [number, number, number][];  // x, y, pressure
  simulatePressure: boolean;
}

interface TextElement extends ElementBase {
  text: string;
  fontSize: number;
  fontFamily: "excalifont" | "nunito" | "mono";
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  lineHeight: number;
}

interface ArrowElement extends ElementBase {
  points: [number, number][];          // relative to x,y
  startBinding: { elementId: string; focus: number } | null;
  endBinding:   { elementId: string; focus: number } | null;
  startArrowhead: "none" | "arrow" | "dot";
  endArrowhead: "none" | "arrow" | "dot";
  elbowed: boolean;
}
```

### 7.3 Postgres schema (Neon)

```sql
users(id uuid pk, email citext unique, name text, image text, created_at timestamptz)
sessions(id text pk, user_id uuid fk, expires_at timestamptz)
boards(id uuid pk, owner_id uuid not null fk, title text, is_public bool, thumbnail_key text,
       content jsonb not null default '{"elements":[]}',   -- materialised snapshot, see 7.4.2
       seq int not null default 0,                          -- last applied update sequence
       created_at timestamptz, updated_at timestamptz, deleted_at timestamptz)
board_members(board_id uuid, user_id uuid, role text check (role in ('editor','viewer')),
       primary key (board_id, user_id))
share_links(id uuid pk, board_id uuid fk, token text unique, role text, expires_at timestamptz, revoked_at timestamptz)
board_updates(id bigserial pk, board_id uuid fk, seq int, update bytea, created_at timestamptz)
board_snapshots(board_id uuid pk, seq int, state bytea, created_at timestamptz)
assets(id uuid pk, board_id uuid fk, key text, mime text, bytes int, created_at timestamptz)
```

Indexes: `board_updates(board_id, seq)`, `boards(owner_id, updated_at desc)`, `share_links(token)`.

### 7.4 Collaboration protocol

- One `Y.Doc` per board. Structure:
  - `elements: Y.Map<id, Y.Map<field, value>>` — field-level merge, so two people editing colour and position of the same shape don't clobber each other.
  - `order: Y.Array<string>` is **not** used; z-order lives in the fractional `index` field (see 7.1).
  - `text:<id>: Y.Text` per text element, so two people typing in one text box merge characters instead of duplicating.
- **Awareness:** cursor position (scene coords), selected element ids, active tool, user id, name, colour, `lastSeen`.
- **Undo:** `Y.UndoManager` scoped to the local client's origin — undo never removes someone else's stroke.
- **Transport:** **Socket.IO** over WebSocket, falling back to HTTP long-polling when a proxy blocks the upgrade. One room per board (`board:<id>`). Sync is the standard Yjs handshake reimplemented as Socket.IO events: `sync:1` carries the client's state vector, `sync:2` returns the missing diff, then both sides emit `update` events. Approximately 120 lines, fully unit-testable, and a better interview story than importing someone else's transport.
- **Auth:** the app mints a short-lived (5 min) HS256 JWT scoped to `{ boardId, userId, role }`, passed in the Socket.IO `auth` handshake payload. The service verifies it in a `io.use()` middleware; viewers join read-only and their `update` events are dropped.
- **Persistence:** the service keeps one live `Y.Doc` per active board in process memory and writes a compacted snapshot straight to Postgres through `packages/db` every 60s or 200 updates, updating `boards.content` and `boards.seq`. Postgres is the durable read path (7.4.1); memory is the working copy. A board opens from Postgres, then joins its room, which replays anything newer than the snapshot's `seq`.
- **Reconnect:** exponential backoff 1s → 30s with jitter, resuming from the last known `seq`. On `visibilitychange → visible`, reconnect immediately and ignore backoff.

#### 7.4.1 Canonical storage and the read path

There is exactly **one read path** and it does not touch the collab service:

1. `GET /api/boards/:id` (Vercel → Postgres) returns `content` (a materialised element array), `seq`, and the caller's role.
2. The client paints that snapshot immediately — it can draw and navigate before any socket opens.
3. It then connects to the collab service with the last known `seq`; the service replays only `board_updates` with `seq > snapshotSeq`.

`board_updates` + `board_snapshots` are the **write-ahead truth**. `boards.content` is a denormalised cache of the latest applied state, rewritten by the collab service on every compaction (60s or 200 updates) and written directly by REST **only in Sprint 2**, before Yjs exists. Sprint 3 therefore *adds* a writer; it does not replace the persistence layer.

Consequence: a share-link visitor, a dashboard thumbnail, an export, and a search result all read from Postgres. The collab service is a streaming delta source, never a source of truth.

**Size limits:** Vercel functions cap request bodies at 4.5 MB. Board payloads are capped at **2,000 elements and 2 MB of serialised JSON**; exceeding either blocks the save with a clear error and offers export.

#### 7.4.2 Degraded mode

If the collab service is unreachable, the board still opens, renders, and accepts edits. The client buffers updates in IndexedDB and retries with backoff. The top bar shows **"Offline — changes saved on this device"**, and the board becomes read-only for *multiplayer* actions only: no live cursors, no presence, and "Share" is disabled with an explanatory tooltip.

This is what makes the collab-host risk acceptable: a collab-service outage costs collaboration, not the product.

#### 7.4.3 Guests and share links

A share link is the product's front door, so it must work for a logged-out visitor.

- **Identity:** on first visit the client mints a `guestId` (UUID v4) and stores it in `localStorage`. It is namespaced to the board, not global, so links cannot be correlated across boards.
- **JWT:** the web app issues `{ boardId, sub: "guest:<guestId>", role }` with a 5-minute TTL, refreshed by the client while the tab is open. The collab service verifies signature and expiry only — it never mints tokens.
- **Guests can draw** when the link role is `editor`. Their presence shows a generated name ("Guest Otter") and colour, which they can rename for the session. Their edits persist normally and are attributed to the guest id.
- **Abuse limits:** guests cannot upload images, cannot create boards, are capped at 30 minutes of edit time per board link, and are rate-limited to 20 board joins per hour per IP. Guests exceeding a limit are downgraded to viewer, never disconnected.
- **Anonymous boards never reach Postgres.** A scratch board lives only in IndexedDB with a client-generated id. On signup the local board is inserted with `owner_id = <new user>`; if the id collides (astronomically unlikely, 21-char nanoid), a new id is generated. There is no "claim token" because there is nothing server-side to claim and no id to guess.
- **Sharing an anonymous board requires signup**, because issuing a share link requires an owner. This is the one deliberate signup prompt, and it appears only when the user asks to share.

### 7.5 Auth and sharing

- **Better Auth**, email + password and Google OAuth. Sessions in Postgres.
- Every persisted board has a real owner (`owner_id not null`). Anonymous scratch boards live only in IndexedDB until signup, per 7.4.3.
- Sharing: the owner mints a link with role `editor` or `viewer` and an optional expiry. The token is 128 bits of randomness, stored as a SHA-256 hash; the raw token appears only in the URL. Revoking sets `revoked_at` and invalidates the cache entry immediately.
- Viewers see the board read-only with live cursors. Role is enforced in three places: the REST response, the JWT claim, and the collab service's update handler.

### 7.6 Files

**Object storage is deferred, not designed away.** Every free-tier object store worth using (Cloudflare R2 above all) requires a payment method on file, which breaks the ₹0 constraint. The `assets` table and the `image` element type stay in the schema, but the upload path is not built at launch.

- Board thumbnails are rendered client-side (256×160 PNG), compressed to ~15 KB, and stored as a `data:` URL in `boards.thumbnail_key`. At that size, 100 boards cost ~1.5 MB of Postgres — well inside the free tier.
- Native image upload returns an explicit "Images ship in a later version" state. Do not fake it, do not ship a broken button.
- When a host with free object storage is available (a free S3-compatible tier that does not demand a card), only `POST /api/upload` and the element's `src` handling change.
- The resume does not claim image support, so nothing above is a gap against it.

### 7.7 Hosting, verified 2026-10-31

Every fact below comes from the provider's own documentation, not a listicle. The collab service must be a **long-lived Node process that holds WebSocket connections**, which rules out most of the free-tier landscape.

| Candidate | Verdict | Why |
|---|---|---|
| **Render free** | ✅ **Chosen** | 512 MB / 0.1 CPU, 750 instance-hours per month, WebSockets supported, no card. Sleeps after 15 min with no inbound traffic (a WebSocket message counts as traffic, so an active board stays awake). Wakes in ~60 s on an HTTP request or a new WebSocket connection |
| SnapDeploy free | ❌ | No card and 4 containers, but **WebSockets are Always-On only** ($12/mo). Its own docs say so. Dead for Socket.IO |
| Back4App Containers | ❌ | No card and supports WebSockets, but 256 MB / 0.25 CPU and reports describe a 60-minute window per deploy. A demo host, not a service |
| Koyeb | ❌ | Card required since Feb 2026, $29 pre-authorisation hold |
| Hugging Face Spaces | ❌ | Docker and Gradio Spaces moved behind PRO |
| Cloudflare Workers | ❌ | V8 isolates, not Node. No Socket.IO server |
| Botkeep | ⏸ | 2 GB / 1.5 vCPU / 5 slots, no card — the best hardware of the bunch, but has shown zero free capacity since 2026-10-31 ("No server capacity is available"). Kept as an optional upgrade, not a dependency |

**Render's two real traps, and the mitigations:**

1. **750 instance-hours/month.** A single service awake 24/7 needs ~730–744 h, leaving ~6 h of headroom — one careless second service and the workspace suspends until the 1st. Mitigation: the uptime ping runs **08:00–24:00 IST only** (16 h/day ≈ 500 h/month). Overnight sleep is fine; nobody demos at 4 a.m. and the 60 s wake is acceptable.
2. **5 GB/month outbound on Hobby, and WebSocket responses are billed.** Without a payment method, exceeding it **spins the service down until next month** — no card means no bill, but also no overage grace. Mitigation: Yjs diffs are tiny, and the client caps resync payloads; the board's 2 MB size cap bounds a worst-case full sync. 5 GB ≈ 2 500 full-board loads a month, far above portfolio traffic. Watch the Metrics page, and know the failure mode is "collab offline until the 1st", never data loss — Postgres still serves every board.

**Cold start is a product decision, not just an ops detail.** A recruiter clicking a shared link after hours waits ~60 s before cursors appear. Mitigations, in order: the app renders the board from Postgres immediately (60 s of latency hits only multiplayer, not the drawing); the collab client shows "Connecting…" rather than failing; and the landing page's live demo pings `/health` on mount so the service is warm by the time anyone opens a board.

**Why the host choice does not touch the code:** `services/collab` reads `PORT` and `DATABASE_URL` from the environment, exposes `GET /health`, and is a single `node dist/index.js`. Moving to Botkeep, Fly, or a VPS is a config change. This is stated in the README as a deliberate design property, because "we picked a host and now we're stuck with it" is the far more common outcome.

**What 0.1 vCPU buys:** enough for ~5–10 concurrent editors on a board, because Yjs merging is cheap and the heavy work (rendering) is on the client. It is not enough to claim production scale, and the README will not claim it. The demo target is a room of 4–6 people, which is also what "concurrent sessions" on the resume needs to prove.


---

## 8. Performance budgets

| Metric | Budget |
|---|---|
| Board route JS (gzipped) | ≤ 220 KB |
| Time to interactive, mid-tier Android, 4G | ≤ 3.0 s |
| Frame time, 1,000 elements, desktop | ≤ 16 ms |
| Frame time, 500 elements, tier C phone | ≤ 33 ms |
| Stylus input latency (Xiaomi Pad 7 + Focus Pen, Chrome) | ≤ 50 ms; Apple Pencil unverified |
| Memory, 1,000 elements | ≤ 200 MB |
| Sync latency, same region, p95 | ≤ 150 ms |
| Board open, cached | ≤ 1.0 s |
| Board open, cold | ≤ 2.5 s |

Budgets are enforced in CI where possible (bundle size check) and in a Playwright perf test where not (frame time with a 1,000-element fixture).

---

## 9. Testing

- **Unit (Vitest):** transforms, hit-testing, fractional index ordering, arrow binding, snapping, history coalescing, serialization round-trip, element bounds with rotation.
- **Engine integration:** render to a mock 2D context and assert draw calls for culling and caching.
- **E2E (Playwright):** draw a rectangle, style it, undo, export PNG; share a link and open it in a second context; two-context collaboration with cursor presence; offline → edit → online merge.
- **Device emulation:** iPhone 13 (Safari engine via WebKit), iPad (touch + Pencil via CDP), Pixel 7 (Chromium), desktop 1440×900.
- **Manual checklist on real hardware before launch.** Owned: Poco F6 (Android phone, Chrome), Xiaomi Pad 7 + Xiaomi Focus Pen (Android tablet, stylus with pressure), Asus TUF F15 (Windows, trackpad + mouse). Pen behaviour — palm rejection, pressure, coalesced events — is testable on this hardware and must be signed off there.
- **Unverified by design, and labelled as such in the README:** iOS Safari, iPadOS, Apple Pencil pressure/tilt, macOS trackpad gestures. These are covered only by Playwright's WebKit emulation, which is not the same engine build as iOS Safari. Do not claim iOS support until it has been opened on an iPhone.

---

## 10. Observability

- **Sentry** (free tier) for client and collab-service errors, with release tags.
- **PostHog** (free tier) for funnel: land → draw → signup → share → second collaborator.
- Custom performance marks: `board:open`, `board:firstPaint`, `stroke:latency`.
- `GET /api/health` on the app and on the collab service.

---

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Socket.IO needs sticky sessions once it runs on more than one instance | Medium (at scale) | Medium | Launch on one instance; document the Redis adapter + sticky routing as the scale-out path, and say so honestly in the README rather than pretending it already scales |
| Mobile text editing is unusable | Medium | High | Build the textarea overlay in sprint 1; test weekly on the Poco F6 and the Pad 7 (iOS keyboard behaviour stays unverified) |
| Yjs + undo interact badly | Medium | Medium | Scope undo per-origin, snapshot tests for multi-user undo |
| iOS Safari memory kill on big boards | Low | High | Element caps, image downscaling, tier C limits |
| Render free cold start (~60 s) makes a shared link feel broken | Certain after 15 min idle | High (it is the first thing a recruiter sees) | Board renders from Postgres before the socket connects; "Connecting…" state; landing page pings `/health`; uptime ping 08:00–24:00 IST so the service is warm during waking hours |
| Render's 750 instance-hours/month run out, suspending the workspace until the 1st | Low | Medium | 16 h/day ping ≈ 500 h/month, leaving 250 h of headroom. Sleep itself is free |
| Render's 5 GB/month outbound is exceeded, and without a card the service spins down until the 1st | Low | Medium | 2 MB board cap bounds a full resync; 5 GB ≈ 2 500 board loads. Metrics page is checked monthly. Failure mode is collab-offline, never data loss |
| No iOS device or Apple Pencil available for testing | Certain | Medium | WebKit emulation in Playwright; iOS-specific bugs are documented as unverified, not claimed as working |
| 12 weeks slips | High | Medium | Phases are shippable independently; Phase 1 alone is a portfolio piece |
| Scope creep into "all Excalidraw features" | High | High | Non-goals list is binding; new ideas go to a `BACKLOG.md` |

---

## 12. Milestones

Each sprint ends with something deployable and demoable.

**Sprint 0 — Weeks 1–2 · Foundations**
Monorepo, CI, deploy pipelines, Socket.IO echo smoke test on Render free, auth, empty board route, design tokens, PWA shell.
*Demo:* sign up, land on an empty board, refresh, still signed in.

**Sprint 1 — Weeks 3–4 · The engine**
Pointer pipeline, pan/zoom, rectangle/ellipse/diamond/line/arrow/freedraw/text, selection, resize/rotate, style panel, undo/redo, IndexedDB persistence.
*Demo:* draw and style a diagram on a phone and a laptop.

**Sprint 2 — Weeks 5–6 · The product shell**
Responsive layout matrix, bottom sheet, dashboard, board CRUD, autosave to Postgres, share links, view-only mode, PNG/SVG/JSON export, thumbnails, dark mode.
*Demo:* create, name, share and export a board from a phone.

**Sprint 3 — Weeks 7–8 · Multiplayer**
Node + Socket.IO collab service, Yjs sync handshake, presence, cursors, snapshot writer, reconnect, offline merge, per-user undo.
*Demo:* two devices, one board, live cursors, kill the wifi and reconnect.

**Sprint 4 — Weeks 9–10 · Fill and polish**
Arrow binding, snapping, grouping, layers, copy/paste, eraser, command palette, keyboard shortcuts, templates gallery.
*Demo:* a polished board that looks like it shipped.

**Sprint 5 — Weeks 11–12 · Launch**
Performance pass against budgets, accessibility pass, Sentry/PostHog, seeded demo board, landing page with live embed, README + architecture write-up, deploy to a real domain.
*Demo:* the link you put on your resume.

---

## 13. Decisions made (mine), and what stays open

**Mine, not negotiable without a good reason:**
- Custom canvas engine over embedding Excalidraw.
- Next.js on Vercel; collab is a Node.js + Socket.IO service on Render free, with Yjs for merge correctness.
- Three breakpoints (768 / 1024), bottom sheet on touch.
- Pointer Events + palm rejection; no separate touch code path.
- Yjs over OT or a custom CRDT.
- Anonymous-first boards, signup to save.
- No billing at launch.

**Open, and only the owner can settle:**
- Domain name (`penpaper.vercel.app` + `*.onrender.com` are ₹0; a real domain is ₹700–900/year and is **not** required).
- Whether to keep Botkeep as a second collab host if its free capacity ever returns. Purely optional — the Render deploy is the plan of record.

**Left to the builder, within the plan:**
- Exact component file boundaries inside `packages/ui`.
- Icon set and illustration choices.
- Copy tone for empty states and onboarding.

---

## 14. Resume alignment

The submitted resume says this:

> **PenPaper — Real-Time Collaborative Whiteboard** | React, TypeScript, Node.js, Socket.IO, Canvas
> – Developing an interactive infinite-canvas whiteboard supporting freehand drawing, geometric shapes, text annotations, connectors, and diagram creation.
> – Implementing real-time multi-user collaboration using WebSockets, enabling synchronized canvas operations across concurrent sessions.
> – Designing a scalable frontend architecture with reusable React components, efficient canvas rendering, and persistent whiteboard storage.

Every claim above is now a build requirement. This table is the checklist before the project is described as finished — and before any interview.

| Claim | Where it is built | Proof to keep |
|---|---|---|
| Infinite canvas | Camera + unbounded scene, 7.1 | Demo: pan/zoom at 30 000×, no clipping |
| Freehand drawing | `freedraw` with perfect-freehand + pressure | Focus Pen recording on the Pad 7 |
| Geometric shapes | 7 shape types, 7.1 | E2E test per type |
| Text annotations | Canvas text + textarea overlay, 6.4 | E2E: type, wrap, commit, reload |
| **Connectors** | Arrow binding, Sprint 4 — *not yet in Phase 1* | Demo: arrow stays attached when the shape moves |
| Diagram creation | Templates gallery + duplicate/group | Seeded demo board |
| React + TypeScript | Next.js 16 app, `packages/ui` | Repo |
| **Node.js + Socket.IO** | `services/collab`, deployed as a Node process on Render free — not a serverless function, not a V8 isolate | Repo + the live `*.onrender.com` URL |
| **WebSockets** | Socket.IO transport, polling fallback | Network tab screenshot showing the `websocket` frame |
| Synchronized operations | Yjs merge, field-level | Two-browser test: simultaneous drags both survive |
| Concurrent sessions | Room per board, presence | Playwright with 2 contexts + a 3rd viewer |
| Reusable React components | `packages/ui`, shadcn primitives | Component count in README |
| Efficient canvas rendering | Culling, quadtree, rough cache, layered renderer | 1 000-element benchmark numbers |
| Persistent storage | Postgres + IndexedDB local-first | Reload/offline test |

**Wording you must be able to defend.** "Scalable" is the riskiest word in the resume, because the honest answer today is *one Socket.IO instance*. Have this ready: the stateless part is designed to scale (Vercel, Neon), and the stateful part scales by adding the Redis adapter and sticky routing — a config change, not a rewrite. Say that plainly; it lands better than pretending.

**Gap to close before launch:** connectors (arrow binding) currently sit in Sprint 4. They are the one resume claim not covered by the mechanical scope, so they get a dedicated acceptance test and cannot be cut.
