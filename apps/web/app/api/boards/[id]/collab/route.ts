import { currentUser } from "@/lib/server/auth";
import { getBoard } from "@/lib/server/boards";
import { collabConfigured, colorFor, guestName, signCollabToken } from "@/lib/server/collab-token";
import { databaseConfigured } from "@/lib/server/db";
import { cleanBoardId, fail, ok, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  guestId?: unknown;
}

/**
 * A five-minute key to one socket room.
 *
 * The socket service never reads Postgres: it checks this signature and trusts
 * the role inside. Minting it here is what keeps the realtime process small and
 * keeps authorization in one place.
 */
export async function POST(request: Request, context: RouteContext) {
  if (!databaseConfigured) return fail(503, "Accounts are not configured on this server");
  if (!collabConfigured) return fail(503, "Live collaboration is not configured on this server");

  const { id: rawId } = await context.params;
  const id = cleanBoardId(rawId);
  if (!id) return fail(404, "That notepad is not available");

  const share = new URL(request.url).searchParams.get("share");
  const user = await currentUser().catch(() => null);
  const found = await getBoard(id, user?.id ?? null, share);
  if (!found) return fail(404, "That notepad is not available");

  const body = await readJson<Body>(request);
  const guestId =
    typeof body?.guestId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.guestId)
      ? body.guestId
      : null;

  const identity = user?.id ?? guestId;
  if (!identity) return fail(400, "This browser could not be identified");

  const signed = await signCollabToken({
    boardId: id,
    userId: identity,
    role: found.role,
    name: user?.name ?? guestName(identity),
    color: colorFor(identity),
  });

  return ok({ ...signed, role: found.role });
}
