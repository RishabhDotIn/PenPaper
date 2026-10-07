import { createSession, setSessionCookie, verifyPassword } from "@/lib/server/auth";
import { databaseConfigured, ready, sql } from "@/lib/server/db";
import { allow, cleanEmail, clientKey, fail, ok, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

interface Body {
  email?: unknown;
  password?: unknown;
}

export async function POST(request: Request) {
  if (!databaseConfigured) return fail(503, "Accounts are not configured on this server");
  if (!allow(`sign-in:${clientKey(request)}`, 10, 60_000)) {
    return fail(429, "Too many attempts. Try again in a minute.");
  }

  const body = await readJson<Body>(request);
  const email = cleanEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";

  // One message for a wrong address and a wrong password: the difference tells
  // an attacker which half of the pair to keep guessing.
  if (!email || !password) return fail(401, "Email or password is incorrect");

  await ready();
  const [row] = await sql()`
    select id, email, name, password_hash
    from pp_users
    where email = ${email}
  `;

  if (!row || !(await verifyPassword(password, row.password_hash as string))) {
    return fail(401, "Email or password is incorrect");
  }

  const session = await createSession(row.id as string);
  await setSessionCookie(session.token, session.expiresAt);

  return ok({ user: { id: row.id, email: row.email, name: row.name } });
}
