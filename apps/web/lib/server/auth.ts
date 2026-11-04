import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { ready, sql } from "./db";
import type { GoogleIdentity } from "./google";
import { cacheDel, cacheGet, cacheSet } from "./redis";

/**
 * Accounts, backed by Google and by our own sessions.
 *
 * There is no password to store: Google is the only way in, and it hands the
 * page a signed ID token that the server verifies against Google's keys. What
 * remains is the small part that actually matters — a user row per Google
 * account, random session tokens stored only as hashes, and a cookie the
 * browser cannot read. No auth provider, no adapter, no schema generator.
 */

const SESSION_COOKIE = "pp_session";
const SESSION_DAYS = 30;

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Finds the user behind a verified Google identity, creating one if needed.
 *
 * `sub` is Google's stable id, so the same person keeps their board library if
 * they ever change their Google address. If the address already has a row from
 * the old email/password era, this adopts it rather than making a second
 * account: Google has verified that the person owns the address.
 */
export async function signInWithGoogle(identity: GoogleIdentity): Promise<User> {
  await ready();
  const db = sql();

  const [linked] = await db`
    select id, email, name, picture from pp_users where google_sub = ${identity.sub}
  `;
  if (linked) {
    const [updated] = await db`
      update pp_users
      set name = ${identity.name}, picture = ${identity.picture}
      where id = ${linked.id}
      returning id, email, name, picture
    `;
    return updated as User;
  }

  const [row] = await db`
    insert into pp_users (id, email, name, picture, google_sub)
    values (${randomUUID()}, ${identity.email}, ${identity.name}, ${identity.picture}, ${identity.sub})
    on conflict (email) do update
      set google_sub = excluded.google_sub,
          name = excluded.name,
          picture = coalesce(excluded.picture, pp_users.picture)
      where pp_users.google_sub is null
    returning id, email, name, picture
  `;

  if (!row) {
    // The address belongs to a different Google account. Do not merge: two
    // people can share a name, and only one of them owns this library.
    throw new Error("That email is connected to a different Google account");
  }

  return row as User;
}

/**
 * Creates a session and returns the raw token.
 *
 * Only its hash is stored, so a database dump cannot be replayed as a login.
 */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  await ready();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await sql()`
    insert into pp_sessions (token_hash, user_id, expires_at)
    values (${hashToken(token)}, ${userId}, ${expiresAt})
  `;

  // Cheap housekeeping: signing in is rare, and this keeps the table from
  // growing for a year of expired tabs.
  await sql()`delete from pp_sessions where expires_at < now()`;

  return { token, expiresAt };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await ready();
  const hash = hashToken(token);
  await sql()`delete from pp_sessions where token_hash = ${hash}`;
  // Drop the cached copy too, or a signed-out tab keeps resolving to its user
  // for as long as the cache entry lives.
  await cacheDel(`session:${hash}`);
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function sessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

/** The signed-in user, or null. Never throws for a missing/expired cookie. */
export async function currentUser(): Promise<User | null> {
  const token = await sessionToken();
  if (!token) return null;

  const hash = hashToken(token);

  // Every API route resolves the caller, and every board read or save goes
  // through one. On the free instance that round-trip is the most frequent
  // query in the app, and a session changes only when it is created or
  // destroyed, so a short cache is worth more here than anywhere else.
  const cached = await cacheGet<{ user: User; expiresAt: number }>(`session:${hash}`);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  await ready();
  const [row] = await sql()`
    select u.id, u.email, u.name, u.picture, s.expires_at
    from pp_sessions s
    join pp_users u on u.id = s.user_id
    where s.token_hash = ${hash} and s.expires_at > now()
  `;
  if (!row) return null;

  const user: User = {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    picture: (row.picture as string | null) ?? null,
  };

  const expiresAt = (row.expires_at as Date).getTime();
  const remaining = expiresAt - Date.now();
  if (remaining > 0) {
    // Never outlive the session itself, and never cache for more than five
    // minutes so a database-side revocation is not invisible for long.
    await cacheSet(`session:${hash}`, { user, expiresAt }, Math.min(5 * 60_000, remaining));
  }

  return user;
}
