import { resolveShare } from "@/lib/server/boards";
import { databaseConfigured } from "@/lib/server/db";
import { fail, ok } from "@/lib/server/http";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * Turns a share link into the board it points at.
 *
 * `/s/<token>` calls this once and then carries the token in the board URL, so
 * a reload keeps working and the resolver is not on the drawing path.
 */
export async function GET(_request: Request, context: RouteContext) {
  if (!databaseConfigured) return fail(503, "Sharing is not configured on this server");

  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return fail(404, "That link is not valid");

  const target = await resolveShare(token);
  if (!target) return fail(404, "That link has expired or was turned off");

  return ok({ boardId: target.boardId, role: target.role });
}
