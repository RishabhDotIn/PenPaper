import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { ready, sql } from "./db";

/**
 * Accounts without an auth provider.
 *
 * The alternative was Better Auth, which brings a schema generator, an adapter,
 * and a version to track for four endpoints and one cookie. What is here is the
 * part that actually matters: scrypt password hashes with a per-user salt,
 * random session tokens stored as hashes, and a cookie the browser cannot read.
 */

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const SESSION_COOKIE = "pp_session";
const SESSION_DAYS = 30;
/** scrypt work factor: 16 MB of memory per hash, about 40 ms on a laptop. */
const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 64 };

export interface User {
  id: string;
  email: string;
  name: string;
}

function toHex(buffer: Buffer): string {
  return buffer.toString("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  })) as Buffer;

  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${toHex(salt)}$${toHex(key)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, "hex");
  const key = (await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  })) as Buffer;

  return key.length === expected.length && timingSafeEqual(key, expected);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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
  await sql()`delete from pp_sessions where token_hash = ${hashToken(token)}`;
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

  await ready();
  const [row] = await sql()`
    select u.id, u.email, u.name
    from pp_sessions s
    join pp_users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)} and s.expires_at > now()
  `;

  return (row as User | undefined) ?? null;
}
