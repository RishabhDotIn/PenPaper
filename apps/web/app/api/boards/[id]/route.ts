import { currentUser } from "@/lib/server/auth";
import {
  deleteBoard,
  getBoard,
  looksLikeContent,
  MAX_CONTENT_BYTES,
  renameBoard,
  saveBoard,
  type BoardContent,
  type Role,
} from "@/lib/server/boards";
import { databaseConfigured } from "@/lib/server/db";
import { cleanTitle, fail, ok, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  title?: unknown;
  content?: unknown;
}

/** Who is asking, and what they may do with this board. */
async function access(id: string, share: string | null) {
  const user = await currentUser().catch(() => null);
  const found = await getBoard(id, user?.id ?? null, share);
  return { user, found };
}

const canWrite = (role: Role): boolean => role === "owner" || role === "editor";

/**
 * The board, its role, and the caller.
 *
 * `?share=<token>` is the whole authorization story for a link: the server
 * resolves it on every request, so revoking a link takes effect on the next
 * save rather than when a tab is closed.
 */
export async function GET(request: Request, context: RouteContext) {
  if (!databaseConfigured) return fail(503, "Accounts are not configured on this server");

  const { id } = await context.params;
  const share = new URL(request.url).searchParams.get("share");
  const { found } = await access(id, share);
  if (!found) return fail(404, "That notepad is not available");

  return ok({ board: found.board, role: found.role });
}

/** Autosave. Owner and editor only; a viewer link never reaches this branch. */
export async function PUT(request: Request, context: RouteContext) {
  if (!databaseConfigured) return fail(503, "Accounts are not configured on this server");

  const { id } = await context.params;
  const share = new URL(request.url).searchParams.get("share");
  const { found } = await access(id, share);
  if (!found) return fail(404, "That notepad is not available");
  if (!canWrite(found.role)) return fail(403, "This link is view only");

  const body = await readJson<PatchBody>(request);
  if (!looksLikeContent(body?.content)) return fail(400, "That notepad is not a valid drawing");

  const content = body.content as BoardContent;
  if (JSON.stringify(content).length > MAX_CONTENT_BYTES) {
    return fail(413, "That notepad is too large to save");
  }

  const title = cleanTitle(body?.title, found.board.title);
  const seq = await saveBoard({ id, title, content });

  return ok({ seq, savedAt: Date.now(), role: found.role });
}

/** Rename, without touching the drawing. */
export async function PATCH(request: Request, context: RouteContext) {
  if (!databaseConfigured) return fail(503, "Accounts are not configured on this server");

  const { id } = await context.params;
  const share = new URL(request.url).searchParams.get("share");
  const { found } = await access(id, share);
  if (!found) return fail(404, "That notepad is not available");
  if (!canWrite(found.role)) return fail(403, "This link is view only");

  const body = await readJson<PatchBody>(request);
  const title = cleanTitle(body?.title, found.board.title);
  await renameBoard(id, title);

  return ok({ title });
}

/** Deleting is the owner's act; an editor can empty a board but not remove it. */
export async function DELETE(_request: Request, context: RouteContext) {
  if (!databaseConfigured) return fail(503, "Accounts are not configured on this server");

  const { id } = await context.params;
  const { found } = await access(id, null);
  if (!found) return fail(404, "That notepad is not available");
  if (found.role !== "owner") return fail(403, "Only the owner can delete this notepad");

  await deleteBoard(id);
  return ok({ ok: true });
}
