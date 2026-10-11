"use client";

import { googleClientId, loadGisScript } from "@/lib/google/gis";

/**
 * Google sign-in, browser only.
 *
 * PenPaper has no backend to hold a secret or a refresh token, and it does not
 * want one: a static app on a free host can make Drive calls with a short-lived
 * access token that Google's Identity Services hands to the page. The token
 * lives an hour, is scoped to files this app created (`drive.file`), and is
 * never sent anywhere except googleapis.com.
 *
 * Two storage decisions worth knowing:
 *  - The token sits in `sessionStorage`, so it dies with the tab and a new tab
 *    asks once. A long-lived bearer token in `localStorage` would outlive the
 *    session that authorised it.
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
 */
export function requestSession(): Promise<DriveSession> {
  if (!driveConfigured()) {
    return Promise.reject(new DriveAuthError("Google Drive is not configured", "no-client-id"));
  }
  const live = getSession();
  if (live) return Promise.resolve(live);

  // Two quick taps must not open two popups.
  if (pending) return pending;

  pending = (async () => {
    await loadGis();
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) throw new DriveAuthError("Google sign-in did not load", "script-failed");

    const response = await new Promise<GoogleTokenResponse>((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: driveClientId(),
        scope: SCOPES,
        // Only the scopes asked for here: a token that also carries whatever
        // this Google project was granted elsewhere is broader than we need.
        include_granted_scopes: false,
        callback: resolve,
        error_callback: (error) =>
          reject(new DriveAuthError(error.message ?? "Sign-in failed", error.type ?? "error")),
      });
      client.requestAccessToken();
    });

    if (response.error || !response.access_token) {
      throw new DriveAuthError(
        response.error_description ?? response.error ?? "Sign-in was cancelled",
        response.error ?? "error",
      );
    }

    const account = await fetchAccount(response.access_token);
    const next: DriveSession = {
      token: response.access_token,
      expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
      account,
    };
    persist(next);
    return next;
  })();

  return pending.finally(() => {
    pending = null;
  });
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
  restored = false;
  listeners.clear();
}
