import { createSession, setSessionCookie, signInWithGoogle } from "@/lib/server/auth";
import { databaseConfigured } from "@/lib/server/db";
import { googleConfigured, verifyGoogleAccessToken } from "@/lib/server/google";
import { allow, clientKey, fail, ok, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

interface Body {
  accessToken?: unknown;
}

/**
 * The only way to sign in.
 *
 * The browser runs one Google consent and posts the access token here. The
 * server asks Google who it belongs to and checks the audience, then answers
 * with PenPaper's own session cookie. The same token stays in the tab for
 * Drive, which is why signing in does not need a second popup later.
 */
export async function POST(request: Request) {
  if (!databaseConfigured || !googleConfigured) {
    return fail(503, "Google sign-in is not configured on this server");
  }
  if (!allow(`google:${clientKey(request)}`, 12, 60_000)) {
    return fail(429, "Too many attempts. Try again in a minute.");
  }

  const body = await readJson<Body>(request);
  const accessToken = typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
  // Google's tokens are a few hundred bytes. Anything larger is not one.
  if (accessToken.length < 20 || accessToken.length > 4_096) {
    return fail(400, "Sign-in did not complete. Try again.");
  }

  const identity = await verifyGoogleAccessToken(accessToken);
  if (!identity) return fail(401, "Google could not confirm that sign-in");

  let user;
  try {
    user = await signInWithGoogle(identity);
  } catch (error) {
    console.warn("PenPaper: could not link the Google account", error);
    return fail(409, "That Google account is already connected to another PenPaper account");
  }

  const session = await createSession(user.id);
  await setSessionCookie(session.token, session.expiresAt);

  return ok({ user });
}
