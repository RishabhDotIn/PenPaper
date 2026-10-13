"use client";

import { googleClientId, loadGisScript } from "@/lib/google/gis";

/**
 * Google sign-in, browser only.
 *
 * One consent covers both jobs: the popup asks for an identity (`openid email
 * profile`) and for file access (`drive.file`), so a new account arrives with
 * its Drive connection already granted. Asking twice made the menu look like
 * two sign-ups.
 *
 * PenPaper has no backend secret and no refresh token: the page gets a
 * short-lived access token from Google Identity Services, sends it once to
 * `/api/auth/google` so the server can confirm who it belongs to, and keeps it
 * for Drive calls. It is scoped to files this app created.
 *
 * Two storage decisions worth knowing:
 *  - The token sits in `sessionStorage`, so it dies with the tab and a new tab
 *    renews it silently (Google already knows the grant).
 *  - The account's name and picture sit in `localStorage`, no secret in them,
 *    so the shelf can say "Connected as Ada" and offer one tap to reconnect.
 */

export interface DriveAccount {
  email: string;
  name: string;
  picture: string;
}

export interface DriveSession {
  token: string;
  expiresAt: number;
  account: DriveAccount;
}

/** Per-file access only. Also a non-sensitive scope, so no app review. */
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const IDENTITY_SCOPE = "openid email profile";
const SCOPES = `${IDENTITY_SCOPE} ${DRIVE_SCOPE}`;

const TOKEN_KEY = "penpaper:drive:token:v1";
const ACCOUNT_KEY = "penpaper:drive:account:v1";

/** Refresh this long before Google's own expiry, so a save cannot race it. */
const EXPIRY_MARGIN_MS = 60_000;

export class DriveAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "DriveAuthError";
  }
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * What the consent popup returned, before anything is stored.
 *
 * The token may carry fewer scopes than asked for: Google lets a person
 * untick a permission, and a personal-info box cannot be crossed off but a
 * Drive one can. Callers that need Drive must check `grantHasDrive`.
 */
export interface GoogleGrant {
  token: string;
  expiresAt: number;
  account: DriveAccount;
  scopes: string[];
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

interface GoogleAccounts {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        include_granted_scopes?: boolean;
        callback: (response: GoogleTokenResponse) => void;
        error_callback?: (error: { type?: string; message?: string }) => void;
      }) => TokenClient;
      revoke: (token: string, done?: () => void) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

const listeners = new Set<() => void>();

let session: DriveSession | null = null;
let pending: Promise<DriveSession> | null = null;
let popup: Promise<GoogleGrant> | null = null;
let restored = false;

export function driveClientId(): string {
  return googleClientId();
}

/**
 * A missing or truncated client id must not look like a network failure, and
 * must not block the rest of the app: without it PenPaper simply stays local.
 */
export function driveConfigured(): boolean {
  const id = driveClientId();
  return id.endsWith(".apps.googleusercontent.com") && id.length > 30;
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeDrive(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readJson<T>(storage: Storage | null, key: string): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked storage area only costs convenience, never the board.
  }
}

function sessionStorageArea(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function localStore(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The account that last connected on this device, even without a live token. */
export function rememberedAccount(): DriveAccount | null {
  return readJson<DriveAccount>(localStore(), ACCOUNT_KEY);
}

function persist(next: DriveSession | null): void {
  session = next;
  writeJson(sessionStorageArea(), TOKEN_KEY, next);
  if (next) writeJson(localStore(), ACCOUNT_KEY, next.account);
  notify();
}

function restore(): void {
  if (restored) return;
  restored = true;

  const stored = readJson<DriveSession>(sessionStorageArea(), TOKEN_KEY);
  if (stored && typeof stored.token === "string" && stored.expiresAt > Date.now()) {
    session = stored;
  }
}

/** A token that can be used right now, or null. Never prompts. */
export function getSession(): DriveSession | null {
  restore();
  if (!session) return null;
  if (session.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return session;
  persist(null);
  return null;
}

export function hasSession(): boolean {
  return getSession() !== null;
}

export function getAccessToken(): string | null {
  return getSession()?.token ?? null;
}

function loadGis(): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.reject(new DriveAuthError("No document", "unsupported"));
  }

  return loadGisScript().catch(() => {
    throw new DriveAuthError("Could not reach Google sign-in", "script-failed");
  });
}

async function fetchAccount(token: string): Promise<DriveAccount> {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new DriveAuthError("Could not read the Google account", "userinfo-failed");
  }
  const body = (await response.json()) as {
    email?: string;
    name?: string;
    picture?: string;
  };
  return {
    email: body.email ?? "",
    name: body.name ?? body.email ?? "Google account",
    picture: body.picture ?? "",
  };
}

/**
 * The consent popup. Call this from a click — Google's token flow is a popup,
 * and browsers block popups that are not tied to a gesture.
 *
 * `silent` renews from a grant this browser already gave. Google answers
 * without any UI, or fails at once with `interaction_required`, which is the
 * signal to show a Connect button instead.
 *
 * Nothing is stored here: the grant is returned so the caller can sign in
 * first, and only then keep the Drive half.
 */
export function requestGrant(options: { silent?: boolean } = {}): Promise<GoogleGrant> {
  if (!driveConfigured()) {
    return Promise.reject(new DriveAuthError("Google is not configured", "no-client-id"));
  }

  // Two quick taps must not open two popups. A silent attempt has no popup to
  // share, so it never has to join one.
  if (options.silent) return takeGrant(options);

  popup ??= takeGrant(options).finally(() => {
    popup = null;
  });
  return popup;
}

async function takeGrant(options: { silent?: boolean; scope?: string }): Promise<GoogleGrant> {
  await loadGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new DriveAuthError("Google sign-in did not load", "script-failed");

  // A renewal asking only for Drive cannot read the profile from Google, but
  // the name and address are already on this device from the first consent.
  const remembered = options.scope === DRIVE_SCOPE ? rememberedAccount() : null;

  const response = await new Promise<GoogleTokenResponse>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: driveClientId(),
      scope: options.scope ?? SCOPES,
      // Only the scopes asked for here: a token that also carries whatever
      // this Google project was granted elsewhere is broader than we need.
      include_granted_scopes: false,
      callback: resolve,
      error_callback: (error) =>
        reject(new DriveAuthError(error.message ?? "Sign-in failed", error.type ?? "error")),
    });
    client.requestAccessToken(options.silent ? { prompt: "none" } : undefined);
  });

  if (response.error || !response.access_token) {
    throw new DriveAuthError(
      response.error_description ?? response.error ?? "Sign-in was cancelled",
      response.error ?? "error",
    );
  }

  return {
    token: response.access_token,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
    account: remembered ?? (await fetchAccount(response.access_token)),
    scopes: (response.scope ?? "").split(" ").filter(Boolean),
  };
}

/** A grant only becomes a session if Google actually left the Drive scope on. */
export function adoptSession(grant: GoogleGrant): DriveSession | null {
  if (!grant.scopes.includes(DRIVE_SCOPE)) return null;

  const next: DriveSession = {
    token: grant.token,
    expiresAt: grant.expiresAt,
    account: grant.account,
  };
  persist(next);
  return next;
}

/** The existing session, or a fresh one that can call Drive. */
export function requestSession(options: { silent?: boolean } = {}): Promise<DriveSession> {
  if (!driveConfigured()) {
    return Promise.reject(new DriveAuthError("Google Drive is not configured", "no-client-id"));
  }
  const live = getSession();
  if (live) return Promise.resolve(live);

  // A silent renewal and a press of Connect are different intentions; only the
  // visible one is shared, so a press during a renewal still opens a popup.
  if (options.silent) return requireDrive(silentGrant());

  pending ??= requireDrive(requestGrant()).finally(() => {
    pending = null;
  });
  return pending;
}

/**
 * A returning tab has the account cookie already; it only needs the Drive
 * half back. Asking for the identity scopes again would make a grant from the
 * two-consent era look like it needs a new one.
 */
function silentGrant(): Promise<GoogleGrant> {
  const remembered = rememberedAccount();
  return takeGrant(remembered ? { silent: true, scope: DRIVE_SCOPE } : { silent: true });
}

async function requireDrive(grant: Promise<GoogleGrant>): Promise<DriveSession> {
  const adopted = adoptSession(await grant);
  if (!adopted) {
    throw new DriveAuthError("Drive access was not granted", "scope-missing");
  }
  return adopted;
}

/** The existing session, or a fresh one. The caller must be a user gesture. */
export async function ensureSession(): Promise<DriveSession> {
  return getSession() ?? (await requestSession());
}

/** Used by the API layer after a 401: the token lapsed before its clock did. */
export async function renewSession(): Promise<DriveSession> {
  persist(null);
  return requestSession();
}

export function signOut(): void {
  const token = getSession()?.token ?? null;
  persist(null);
  writeJson(localStore(), ACCOUNT_KEY, null);

  if (token) {
    try {
      window.google?.accounts?.oauth2.revoke(token);
    } catch {
      // Revoking is a courtesy: Google expires the token within the hour.
    }
  }
}

/** Test seam: drops module state without touching storage. */
export function __resetDriveAuthForTests(): void {
  session = null;
  pending = null;
  popup = null;
  restored = false;
  listeners.clear();
}
