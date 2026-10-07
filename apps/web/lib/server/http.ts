import { NextResponse } from "next/server";

/** Small helpers shared by the route handlers. */

export interface ApiError {
  error: string;
}

export function fail(status: number, message: string): NextResponse<ApiError> {
  return NextResponse.json({ error: message }, { status });
}

export function ok<T>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, { status });
}

/** Parses a JSON body, or returns null when it is absent or malformed. */
export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * A key for rate limiting: the real client when Render forwards one, else the
 * socket's address. It is advisory — a spoofed header only moves the limit.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "local";
}

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/**
 * A fixed window in process memory.
 *
 * One free Render instance means one process, so this is a real limit rather
 * than a hint. It exists to stop password spraying, not to be a billing meter.
 */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const current = windows.get(key);

  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  current.count += 1;
  if (windows.size > 10_000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }

  return current.count <= limit;
}

/** Trims and bounds a display name. */
export function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.replace(/\s+/g, " ").trim().slice(0, 60);
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Board ids arrive from the URL and from older local storage, so they are
 * accepted in the same alphabet the app already uses: UUIDs, `nb-…`, `demo`.
 * Anything else is refused rather than silently rewritten, because a rewritten
 * id would open a board that is not the one in the address bar.
 */
export function cleanBoardId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return id;
}

export function cleanTitle(raw: unknown, fallback = "Untitled notepad"): string {
  if (typeof raw !== "string") return fallback;
  const title = raw.replace(/\s+/g, " ").trim().slice(0, 120);
  return title.length > 0 ? title : fallback;
}

export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  // Deliberately loose: the address is an identifier here, not a deliverable.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}
