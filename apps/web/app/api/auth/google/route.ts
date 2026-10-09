import { createSession, setSessionCookie, signInWithGoogle } from "@/lib/server/auth";
import { databaseConfigured } from "@/lib/server/db";
import { googleConfigured, verifyGoogleCredential } from "@/lib/server/google";
import { allow, clientKey, fail, ok, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

interface Body {
  credential?: unknown;
}

/**
 * The only way to sign in.
 *
 * The browser gets a signed ID token from Google Identity Services and posts
 * it here. Verification is local (Google's public keys), so there is no client
 * secret and no token exchange on every sign-in; the session that comes back
 * is PenPaper's own cookie.
 */
export async function POST(request: Request) {
  if (!databaseConfigured || !googleConfigured) {
    return fail(503, "Google sign-in is not configured on this server");
  }
  if (!allow(`google:${clientKey(request)}`, 12, 60_000)) {
    return fail(429, "Too many attempts. Try again in a minute.");
  }

  const body = await readJson<Body>(request);
  const credential = typeof body?.credential === "string" ? body.credential : "";
  // A JWT is small. Anything larger is not a credential we issued a popup for.
  if (credential.length < 20 || credential.length > 8_192) {
    return fail(400, "Sign-in did not complete. Try again.");
  }

  const identity = await verifyGoogleCredential(credential);
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
