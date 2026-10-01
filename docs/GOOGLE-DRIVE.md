# Google Drive sync

PenPaper is local-first. Every notepad is written to IndexedDB on the device
immediately and works offline. Drive sync is an **optional extra** that makes the
same notepads appear on every device signed into the same Google account.
Opening `/` reopens the last notepad on that device; the hamburger shows who is
connected and switches between notepads without leaving the canvas.

It costs ₹0 and needs no server of its own:

- The browser talks to Google directly with a short-lived access token.
- There is no backend, no client secret, no refresh token, and no database.
- The app asks only for `drive.file`, a non-sensitive scope that lets it see the
  files it created — not the rest of the user's Drive.

## What the app owner must provide

One value: an **OAuth client ID** for a *Web application*.

```
NEXT_PUBLIC_GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
```

It is not a secret. It is compiled into the public JavaScript bundle and is safe
to commit to a deployment dashboard (but keep it in `.env.local`, not the repo).
**Never** create or paste a client *secret*: this app never uses one.

## Create the client ID (about five minutes)

1. Open <https://console.cloud.google.com/> and create a project, for example
   `PenPaper`. A project is free.
2. **APIs & Services → Library → Google Drive API → Enable.**
3. **APIs & Services → OAuth consent screen.** Google now calls this the
   **Google Auth Platform**, with the consent screen split into three pages:
   - **Branding** — app name `PenPaper`, your support email, developer contact.
   - **Audience** — user type **External**. While the app is in **Testing**, add
     your own Google account under **Test users**; only listed accounts can
     connect, and the consent screen shows an "unverified app" warning that you
     dismiss with **Advanced → Continue**. Testing is free and needs no review.
   - **Data Access** — **Add or remove scopes** and add
     `https://www.googleapis.com/auth/drive.file`,
     `.../auth/userinfo.email`, and `.../auth/userinfo.profile`. On this page
     `drive.file` is listed as **non-sensitive**; keep it that way.
   - For public use, **Audience → Publish app** moves the app to *In
     production*, lifting the 100-test-user cap. Because `drive.file` is
     non-sensitive this needs no OAuth verification and no CASA security
     assessment — the assessment only applies to restricted scopes such as
     `drive` or `drive.readonly`. Branding may still show an unverified notice
     until brand verification is done; that does not block sign-in. Publishing
     is not needed to use it yourself.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**.
   - Name: `PenPaper web`.
   - **Authorized JavaScript origins** (not redirect URIs):
     - `http://localhost:3000`
     - your deployed origin, for example `https://penpaper.onrender.com`
   - No redirect URI is needed: the token flow is a popup, not a redirect.
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`).

> Google requires a secure origin for sign-in. `http://localhost:3000` is
> allowed; a LAN address such as `http://192.168.1.20:3000` is not. Test Drive
> on `localhost` or on the deployed HTTPS site.

## Configure the app

Local development — create `apps/web/.env.local`:

```bash
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
```

Then restart `pnpm --filter web dev` (or rebuild for production, because
`NEXT_PUBLIC_*` values are inlined at build time).

Render — add the same variable to the web service (**Environment → Add
Environment Variable**) and redeploy. The included `render.yaml` declares the
variable with `sync: false`, so its value is set in the dashboard and never
committed.

If the variable is missing, the app stays fully usable: the launcher, the board
menu, and the launcher all say that Drive is not configured on this build. Nothing
breaks.

## Where to connect

- **Board menu → account block** — the primary path. It shows the signed-in
  name, email, and picture, or "On this device" with a **Connect** button.
- **Launcher (`/`)** — a **Connect Drive** button, for a fresh device whose
  notepads are already in Drive.

Signing in must start from one of those clicks: Google's token popup is allowed
only in response to a user gesture.

## What syncs

- One JSON file per notepad named `<title>.penpaper.json` inside a visible
  **PenPaper** folder in **My Drive**. You can open, download, copy, or delete
  those files yourself.
- The drawing and the title. **Not** the camera: zoom and scroll are per device.
- Deletions. Deleting a synced notepad from the menu's notepad list moves its
  Drive file to the trash.

The folder and files are tagged with app-private properties, so PenPaper finds
them even if you rename the folder in Drive. Each file has a stable `boardId`;
the URL of a notepad is `/b/<boardId>` on every device.

### Auto-sync

The **Drive sync** switch in the board menu is **on** by default once an account
is connected: every notepad travels. Turn it to **Choose** to sync per notepad
with the **Sync** / **Remove from Drive** cloud button on each row. The
preference is stored on the device, not in the account.

### Conflicts

The only devices writing a file are the same person's, so the rule is
per-element **last writer wins** on `updatedAt`. Before uploading, PenPaper
downloads the remote file, merges element by element, writes the union locally,
then uploads. Shapes drawn while offline arrive intact; a newer deletion stays
deleted. No edit is silently overwritten by an older copy.

### Offline and expired sessions

The board never waits for Google. It opens from IndexedDB, and the Drive
reconciliation happens in the background. An access token lasts about an hour
and lives in `sessionStorage`, so it disappears with the tab. When it expires,
the next explicit action (Connect, Refresh, Sync) asks Google for a new one; no
refresh token is stored anywhere.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Access blocked: … has not completed the verification process` | Your account is missing from **Audience → Test users**. Add it, or publish the app. |
| No "OAuth consent screen" in the menu | It is now **Google Auth Platform** (<https://console.cloud.google.com/auth/overview>) with **Branding**, **Audience**, and **Data Access** pages. |
| `Error 400: redirect_uri_mismatch` | Wrong client type. Create a **Web application** client and add the exact page origin under **Authorized JavaScript origins**, not redirect URIs. |
| `The given origin is not allowed` | The origin in the address bar is not listed. Add `http://localhost:3000` or the deployed `https://…` origin. |
| `invalid_client` | The client ID is truncated or belongs to another project. Copy the whole value. |
| Sign-in popup never opens | The token request must run from a click. Try again from **Connect Drive**. |
| Sign-in works on the laptop but not the phone | The phone is on a LAN `http://` address. Use the deployed HTTPS site. |
| "Not configured on this build" | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` was missing at build time. Rebuild after setting it. |

## Privacy summary

- Token: browser `sessionStorage`, cleared with the tab; sent only to
  `googleapis.com`.
- Account name, email, and picture: `localStorage`, so the board menu can show
  who is connected; no token is stored with them.
- Board contents: the user's own Google Drive. PenPaper has no server that sees
  them.
- Disconnect removes the local token and forgets the account on that device. It
  does not delete anything from Drive; **Delete** in the notepad list does that.
