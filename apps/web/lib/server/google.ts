import { createRemoteJWKSet, jwtVerify } from "jose";
import { cleanName } from "./http";

/**
 * Verifying a "Sign in with Google" ID token.
 *
 * The browser never sends us a password, and we never ask Google a question
 * per sign-in: the page receives a short JWT signed by Google, and this module
 * checks it against Google's published keys. That keeps the server stateless
 * in the auth sense — no client secret, no token exchange, no refresh token.
 */

const CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID?.trim() ||
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ||
  "";

/** Same shape check the browser uses, so both sides agree on "set up". */
export const googleConfigured =
  CLIENT_ID.endsWith(".apps.googleusercontent.com") && CLIENT_ID.length > 30;

/** Google has used both spellings for the issuer claim. */
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export interface GoogleIdentity {
  /** Stable per Google account; the reason a changed email keeps its boards. */
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

/**
 * The identity behind a credential, or null when it is not one of ours.
 *
 * Null rather than a thrown error: every rejection here is the same sentence
 * to the user, and the caller should not have to map exception types.
 */
export async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity | null> {
  if (!googleConfigured) return null;

  let claims: Record<string, unknown>;
  try {
    const verified = await jwtVerify(credential, keys, {
      issuer: ISSUERS,
      audience: CLIENT_ID,
      // A phone whose clock is a minute fast must still be able to sign in.
      clockTolerance: 60,
    });
    claims = verified.payload as Record<string, unknown>;
  } catch {
    return null;
  }

  const sub = typeof claims.sub === "string" ? claims.sub : "";
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  const verifiedEmail = claims.email_verified === true || claims.email_verified === "true";

  // An account is only useful as a library key if it has an address we can
  // show and deduplicate on, and Google says that address is really theirs.
  if (!sub || !email || !verifiedEmail) return null;

  return {
    sub,
    email,
    name: cleanName(claims.name, email.split("@")[0] ?? "PenPaper"),
    picture: typeof claims.picture === "string" && claims.picture ? claims.picture : null,
  };
}
