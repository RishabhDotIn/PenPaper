import { readFileSync } from "node:fs";
import postgres from "postgres";

/**
 * Connectivity check for the optional Postgres service.
 *
 * Accounts, share links, and durable snapshots are optional, so this is a
 * deploy-morning check rather than part of the build: it proves the pooled Neon
 * URL works from this machine and reports whether the schema exists yet. The
 * API routes create the schema on first use; this script never creates it.
 *
 * Run from `apps/web`: `pnpm --filter web check:db`. `DATABASE_URL` may come
 * from the environment or from `.env.local`, where local development keeps it.
 */

function connectionString() {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;

  try {
    const env = readFileSync(".env.local", "utf8");
    const line = env.split(/\r?\n/).find((row) => row.startsWith("DATABASE_URL="));
    return line?.slice("DATABASE_URL=".length).trim() || null;
  } catch {
    return null;
  }
}

const url = connectionString();
if (!url) {
  console.error(
    "FAIL no DATABASE_URL. Set it in the environment or in apps/web/.env.local.",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

const TABLES = ["pp_users", "pp_sessions", "pp_boards", "pp_share_links"];

try {
  const [row] = await sql`select 1 as ok, version() as version`;
  const found = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ${sql(TABLES)}
  `;
  const present = new Set(found.map((table) => table.table_name));
  const missing = TABLES.filter((name) => !present.has(name));

  console.log("OK", row.ok, row.version.split(",")[0]);
  console.log(
    missing.length === 0
      ? "Schema: all four tables present"
      : `Schema: ${missing.join(", ")} not created yet (first API request creates them)`,
  );
} catch (error) {
  console.error("FAIL", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
