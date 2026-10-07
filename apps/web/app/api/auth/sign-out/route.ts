import { clearSessionCookie, destroySession, sessionToken } from "@/lib/server/auth";
import { ok } from "@/lib/server/http";

export const runtime = "nodejs";

/** Signing out clears the cookie even when the row is already gone. */
export async function POST() {
  const token = await sessionToken();
  try {
    await destroySession(token);
  } catch {
    // A database that is down must not keep a browser signed in.
  }
  await clearSessionCookie();
  return ok({ ok: true });
}
