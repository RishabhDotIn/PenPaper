import { randomUUID } from "node:crypto";
import { hashPassword, createSession, setSessionCookie } from "@/lib/server/auth";
import { databaseConfigured, ready, sql } from "@/lib/server/db";
import { allow, cleanEmail, cleanName, clientKey, fail, ok, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

interface Body {
  email?: unknown;
  password?: unknown;
  name?: unknown;
}

/**
 * Creates an account and signs it in.
 *
 * The response is the same shape as `/api/auth/me`, so the client has one
 * "am I signed in" type rather than two.
 */
export async function POST(request: Request) {
  if (!databaseConfigured) return fail(503, "Accounts are not configured on this server");
  if (!allow(`sign-up:${clientKey(request)}`, 6, 60_000)) {
    return fail(429, "Too many attempts. Try again in a minute.");
  }

  const body = await readJson<Body>(request);
  const email = cleanEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  const name = cleanName(body?.name, email?.split("@")[0] ?? "PenPaper user");

  // 8 is short and 200 is far past any password a person types; the upper
  // bound only protects scrypt from being asked to hash a novel.
  if (!email) return fail(400, "Enter a valid email address");
  if (password.length < 8) return fail(400, "Use at least 8 characters for your password");
  if (password.length > 200) return fail(400, "That password is too long");

  await ready();

  const id = randomUUID();
  const passwordHash = await hashPassword(password);

  try {
    await sql()`
      insert into pp_users (id, email, name, password_hash)
      values (${id}, ${email}, ${name}, ${passwordHash})
    `;
  } catch (error) {
    // 23505 is Postgres' unique violation. Signing up twice with one address
    // is a normal mistake, not a server fault.
    if ((error as { code?: string }).code === "23505") {
      return fail(409, "An account with that email already exists");
    }
    throw error;
  }

  const session = await createSession(id);
  await setSessionCookie(session.token, session.expiresAt);

  return ok({ user: { id, email, name } }, 201);
}
