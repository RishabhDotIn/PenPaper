import { createHash, randomBytes } from "node:crypto";
import type { Element } from "@penpaper/shared";
import { ready, sql } from "./db";

/**
 * Boards, roles, and share links.
 *
 * One rule runs through all of it: a role is decided here, on the server, from
 * the session or the share token. The client is told what it may do; it never
 * tells the server.
 */

export type Role = "owner" | "editor" | "viewer";

export interface BoardContent {
  version: number;
  elements: Element[];
  savedAt?: number;
}

export interface BoardRow {
  id: string;
  ownerId: string;
  title: string;
  content: BoardContent;
  seq: number;
  updatedAt: string;
  createdAt: string;
}

export interface BoardSummary {
  id: string;
  title: string;
  elementCount: number;
  updatedAt: number;
  role: Role;
}

/** 2,000 elements and 2 MB: the size limit the design doc promises. */
export const MAX_ELEMENTS = 2_000;
export const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

export function looksLikeContent(value: unknown): value is BoardContent {
  if (!value || typeof value !== "object") return false;
  const content = value as Partial<BoardContent>;
  if (!Array.isArray(content.elements)) return false;
  if (content.elements.length > MAX_ELEMENTS) return false;
  return content.elements.every((element) => {
    const candidate = element as Partial<Element> | null;
    return Boolean(candidate) && typeof candidate?.id === "string";
  });
}

function countLive(content: BoardContent): number {
  let count = 0;
  for (const element of content.elements) if (!element.isDeleted) count += 1;
  return count;
}

function toSummary(row: {
  id: string;
  title: string;
  content: BoardContent;
  updated_at: Date | string;
}, role: Role): BoardSummary {
  return {
    id: row.id,
    title: row.title,
    elementCount: countLive(row.content),
    updatedAt: new Date(row.updated_at).getTime(),
    role,
  };
}

export async function listBoards(userId: string): Promise<BoardSummary[]> {
  await ready();
  const rows = await sql()`
    select id, title, content, updated_at
    from pp_boards
    where owner_id = ${userId} and deleted_at is null
    order by updated_at desc
    limit 200
  `;

  return (rows as unknown as never[]).map((row) => toSummary(row, "owner"));
}

export interface BoardWithRole {
  board: BoardRow;
  role: Role;
}

/** The board and the caller's role, or null when they may not see it. */
export async function getBoard(
  id: string,
  userId: string | null,
  shareToken: string | null,
): Promise<BoardWithRole | null> {
  await ready();
  const [row] = await sql()`
    select id, owner_id, title, content, seq, updated_at, created_at
    from pp_boards
    where id = ${id} and deleted_at is null
  `;

  if (!row) return null;

  const board: BoardRow = {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    content: row.content as BoardContent,
    seq: row.seq,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };

  if (userId && board.ownerId === userId) return { board, role: "owner" };

  const shared = shareToken ? await resolveShare(shareToken) : null;
  if (shared && shared.boardId === id) return { board, role: shared.role };

  return null;
}

export async function createBoard(options: {
  id: string;
  ownerId: string;
  title: string;
  content?: BoardContent;
}): Promise<BoardSummary> {
  await ready();
  const content: BoardContent = options.content ?? { version: 1, elements: [] };

  const [row] = await sql()`
    insert into pp_boards (id, owner_id, title, content, seq)
    values (${options.id}, ${options.ownerId}, ${options.title}, ${sql().json(content)}, 1)
    on conflict (id) do nothing
    returning id, title, content, updated_at
  `;

  if (!row) {
    // The id already existed. If it is the caller's, this is a harmless
    // re-open; if not, the caller gets a clear conflict instead of a leak.
    const existing = await getBoard(options.id, options.ownerId, null);
    if (!existing) throw new Error("That notepad id is already in use");
    return toSummary(
      {
        id: existing.board.id,
        title: existing.board.title,
        content: existing.board.content,
        updated_at: existing.board.updatedAt,
      },
      existing.role,
    );
  }

  return toSummary(row as never, "owner");
}

export async function saveBoard(options: {
  id: string;
  title: string;
  content: BoardContent;
}): Promise<number> {
  await ready();
  const [row] = await sql()`
    update pp_boards
    set title = ${options.title},
        content = ${sql().json(options.content)},
        seq = seq + 1,
        updated_at = now()
    where id = ${options.id} and deleted_at is null
    returning seq
  `;

  return row?.seq ?? 0;
}

export async function renameBoard(id: string, title: string): Promise<void> {
  await ready();
  await sql()`
    update pp_boards set title = ${title}, updated_at = now()
    where id = ${id} and deleted_at is null
  `;
}

export async function deleteBoard(id: string): Promise<void> {
  await ready();
  await sql()`update pp_boards set deleted_at = now() where id = ${id}`;
}

// ------------------------------------------------------------------ sharing

function hashShare(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface ShareTarget {
  boardId: string;
  role: Exclude<Role, "owner">;
}

/** Creates a share link. The raw token is returned once and never stored. */
export async function createShare(options: {
  boardId: string;
  userId: string;
  role: Exclude<Role, "owner">;
  ttlDays?: number;
}): Promise<{ token: string; role: ShareTarget["role"]; expiresAt: number | null }> {
  await ready();
  const token = randomBytes(24).toString("base64url");
  const expiresAt =
    options.ttlDays === undefined ? null : new Date(Date.now() + options.ttlDays * 86_400_000);

  // One live link per board and role: minting a new one replaces the old, so
  // "Share" cannot quietly leave a second working door open.
  await sql()`
    update pp_share_links set revoked_at = now()
    where board_id = ${options.boardId} and role = ${options.role} and revoked_at is null
  `;

  await sql()`
    insert into pp_share_links (token_hash, board_id, role, created_by, expires_at)
    values (${hashShare(token)}, ${options.boardId}, ${options.role}, ${options.userId}, ${expiresAt})
  `;

  return {
    token,
    role: options.role,
    expiresAt: expiresAt ? expiresAt.getTime() : null,
  };
}

export async function resolveShare(token: string): Promise<ShareTarget | null> {
  if (!token) return null;
  await ready();
  const [row] = await sql()`
    select board_id, role from pp_share_links
    where token_hash = ${hashShare(token)}
      and revoked_at is null
      and (expires_at is null or expires_at > now())
  `;

  return row ? { boardId: row.board_id, role: row.role } : null;
}

export async function revokeShare(boardId: string): Promise<void> {
  await ready();
  await sql()`
    update pp_share_links set revoked_at = now()
    where board_id = ${boardId} and revoked_at is null
  `;
}
