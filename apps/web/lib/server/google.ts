import { cleanName } from "./http";

/**
 * Verifying the Google consent that signs someone in.
 *
 * The page receives a short-lived access token (identity + `drive.file`) and
 * posts it here. This module asks Google what that token means; answering is
 * Google's job, not ours, so there is no client secret and no token exchange
 * code to keep correct.
 *
 * `tokeninfo` is the one endpoint that reports the audience of an access
 * token. Without that check, a token minted for any other Google app would
 * read as a valid identity.
 */

const CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID?.trim() ||
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ||
  "";

/** Same shape check the browser uses, so both sides agree on "set up". */
export const googleConfigured =
  CLIENT_ID.endsWith(".apps.googleusercontent.com") && CLIENT_ID.length > 30;

const TOKENINFO = "https://oauth2.googleapis.com/tokeninfo";

/**
 * Google answers here, so a slow answer must not hold the sign-in request
 * open: five seconds is already longer than a person will wait.
 */
const TIMEOUT_MS = 5_000;

export interface GoogleIdentity {
  /** Stable per Google account; the reason a changed email keeps its boards. */
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

/**
 * The identity behind an access token, or null when it is not one of ours.
 *
 * Null rather than a thrown error: every rejection here is the same sentence
 * to the user, and the caller should not have to map exception types.
 */
export async function verifyGoogleAccessToken(token: string): Promise<GoogleIdentity | null> {
  if (!googleConfigured || !token) return null;

  let claims: Record<string, unknown>;
  try {
    const response = await fetch(`${TOKENINFO}?access_token=${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // An expired or unknown token is a 400 from Google, not a body to read.
    if (!response.ok) return null;
    claims = (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }

  // The audience is what says this token was minted for PenPaper.
  if (claims.aud !== CLIENT_ID) return null;

  const sub = typeof claims.sub === "string" ? claims.sub : "";
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  // tokeninfo reports booleans as strings.
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
