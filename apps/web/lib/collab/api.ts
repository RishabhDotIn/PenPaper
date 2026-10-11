import type { Element } from "@penpaper/shared";

/**
 * The browser's side of the account API.
 *
 * One module owns the fetch calls so the components never assemble a URL or
 * repeat the "parse the error body" dance. Cookies are same-origin, so nothing
 * here ever touches a token.
 */

export type Role = "owner" | "editor" | "viewer";

export interface Account {
  id: string;
  email: string;
  name: string;
  picture?: string | null;
}

export interface AccountState {
  user: Account | null;
  /** Accounts are configured on this deployment. */
  configured: boolean;
  /** The socket service is configured, so live collaboration can start. */
  collab: boolean;
}

export interface ServerBoardContent {
  version: number;
  elements: Element[];
  savedAt?: number;
}

export interface ServerBoard {
  id: string;
  ownerId?: string;
  title: string;
  content: ServerBoardContent;
  seq: number;
  updatedAt: string | number;
  createdAt?: string | number;
}

export interface BoardSummary {
  id: string;
  title: string;
  elementCount: number;
  updatedAt: number;
  role: Role;
}

export interface ShareLink {
  token: string;
  role: Exclude<Role, "owner">;
  expiresAt: number | null;
  path: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // A phone that is offline should read this as "no answer", not as a crash.
    throw new ApiError("Could not reach PenPaper", 0);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? "That did not work", response.status);
  }

  return (await response.json()) as T;
}

export function fetchAccount(): Promise<AccountState> {
  return request<AccountState>("/api/auth/me");
}

/**
 * Signs in with a Google ID token.
 *
 * The credential comes from the GIS button, not from this module: the popup has
 * to open inside a click, and only the button knows when that happened.
 */
export function signInWithGoogle(credential: string): Promise<{ user: Account }> {
  return request("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
}

export function signOut(): Promise<{ ok: true }> {
  return request("/api/auth/sign-out", { method: "POST" });
}

export function listServerBoards(): Promise<{ boards: BoardSummary[] }> {
  return request("/api/boards");
}

export function createServerBoard(input: {
  id: string;
  title: string;
  content: ServerBoardContent;
}): Promise<{ board: BoardSummary }> {
  return request("/api/boards", { method: "POST", body: JSON.stringify(input) });
}

function boardPath(id: string, shareToken?: string | null, suffix = ""): string {
  // The suffix belongs to the path, before the query. Appending "/collab" to a
  // string that already has `?share=…` produces `…?share=token/collab`, which
  // the router reads as a URL for a different endpoint entirely.
  const base = `/api/boards/${encodeURIComponent(id)}${suffix}`;
  return shareToken ? `${base}?share=${encodeURIComponent(shareToken)}` : base;
}

/** The board and this caller's role, or null when it does not exist for them. */
export async function fetchServerBoard(
  id: string,
  shareToken?: string | null,
): Promise<{ board: ServerBoard; role: Role } | null> {
  try {
    return await request(boardPath(id, shareToken));
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
}

export function saveServerBoard(input: {
  id: string;
  shareToken?: string | null;
  title: string;
  content: ServerBoardContent;
}): Promise<{ seq: number; savedAt: number; role: Role }> {
  return request(boardPath(input.id, input.shareToken), {
    method: "PUT",
    body: JSON.stringify({ title: input.title, content: input.content }),
  });
}

export function renameServerBoard(input: {
  id: string;
  shareToken?: string | null;
  title: string;
}): Promise<{ title: string }> {
  return request(boardPath(input.id, input.shareToken), {
    method: "PATCH",
    body: JSON.stringify({ title: input.title }),
  });
}

export function deleteServerBoard(id: string): Promise<{ ok: true }> {
  return request(`/api/boards/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function createShareLink(
  id: string,
  role: Exclude<Role, "owner">,
): Promise<ShareLink> {
  return request(`/api/boards/${encodeURIComponent(id)}/share`, {
    method: "POST",
    body: JSON.stringify({ role }),
  });
}

export function revokeShareLinks(id: string): Promise<{ ok: true }> {
  return request(`/api/boards/${encodeURIComponent(id)}/share`, { method: "DELETE" });
}

export function resolveShareLink(token: string): Promise<{ boardId: string; role: Role }> {
  return request(`/api/share/${encodeURIComponent(token)}`);
}

export function fetchCollabToken(input: {
  id: string;
  shareToken?: string | null;
  guestId: string;
}): Promise<{ token: string; expiresAt: number; role: Role }> {
  return request(boardPath(input.id, input.shareToken, "/collab"), {
    method: "POST",
    body: JSON.stringify({ guestId: input.guestId }),
  });
}
