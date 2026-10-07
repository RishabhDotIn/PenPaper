import { currentUser } from "@/lib/server/auth";
import { createShare, getBoard, revokeShare } from "@/lib/server/boards";
import { databaseConfigured } from "@/lib/server/db";
import { fail, ok, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  role?: unknown;
}

/**
 * Mints one link per role.
 *
 * The raw token is returned once and stored only as a hash, so a database dump
 * cannot be turned into a working URL. Minting a second editor link revokes the
 * first, which keeps "share" from quietly leaving two doors open.
 */
export async function POST(request: Request, context: RouteContext) {
  if (!databaseConfigured) return fail(503, "Accounts are not configured on this server");

  const { id } = await context.params;
  const user = await currentUser().catch(() => null);
  if (!user) return fail(401, "Sign in to share a notepad");

  const found = await getBoard(id, user.id, null);
  if (!found) return fail(404, "That notepad is not available");
  if (found.role !== "owner") return fail(403, "Only the owner can share this notepad");

  const body = await readJson<Body>(request);
  const role = body?.role === "viewer" ? "viewer" : body?.role === "editor" ? "editor" : null;
  if (!role) return fail(400, "Choose whether the link can edit or only view");

  const link = await createShare({ boardId: id, userId: user.id, role });
  return ok({
    token: link.token,
    role: link.role,
    expiresAt: link.expiresAt,
    path: `/s/${link.token}`,
  });
}

/** Revokes every live link for the board. */
export async function DELETE(_request: Request, context: RouteContext) {
  if (!databaseConfigured) return fail(503, "Accounts are not configured on this server");

  const { id } = await context.params;
  const user = await currentUser().catch(() => null);
  if (!user) return fail(401, "Sign in to manage sharing");

  const found = await getBoard(id, user.id, null);
  if (!found) return fail(404, "That notepad is not available");
  if (found.role !== "owner") return fail(403, "Only the owner can manage sharing");

  await revokeShare(id);
  return ok({ ok: true });
}
