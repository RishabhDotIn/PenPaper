import { currentUser } from "@/lib/server/auth";
import { databaseConfigured } from "@/lib/server/db";
import { collabConfigured } from "@/lib/server/collab-token";
import { googleConfigured } from "@/lib/server/google";
import { ok } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * The client's one source of truth about accounts.
 *
 * `configured` is not the same as signed in: it tells the launcher whether to
 * offer a sign-in card at all, and the board whether live sharing can work.
 * Both a database and a Google client id are required — either alone has
 * nothing to offer.
 */
export async function GET() {
  const configured = databaseConfigured && googleConfigured;

  if (!configured) {
    return ok({ user: null, configured: false, collab: false });
  }

  try {
    return ok({
      user: await currentUser(),
      configured: true,
      collab: collabConfigured,
    });
  } catch (error) {
    // A suspended Neon project should present as "signed out", not as a 500
    // on every page that asks who is here.
    console.warn("PenPaper: could not read the session", error);
    return ok({ user: null, configured: true, collab: collabConfigured });
  }
}
