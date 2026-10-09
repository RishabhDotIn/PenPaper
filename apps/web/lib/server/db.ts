import postgres from "postgres";

/**
 * The server's Postgres connection.
 *
 * Everything here is server-only: the module is imported from route handlers
 * and never from a component that ships to the browser.
 *
 * Neon's free plan suspends an idle project, so the first query after a quiet
 * spell can take a second. A single small pool is enough for a free Render
 * instance (0.1 CPU) and keeps connection count well inside Neon's limit; the
 * schema is created on first use rather than by a migration tool, because a
 * one-file deploy with no build step is the whole hosting story.
 */

const connectionString = process.env.DATABASE_URL?.trim();

/** True when accounts, sharing, and server snapshots are configured. */
export const databaseConfigured = Boolean(connectionString);

let client: ReturnType<typeof postgres> | null = null;
let schema: Promise<void> | null = null;

export function sql(): ReturnType<typeof postgres> {
  if (!connectionString) {
    throw new Error("PenPaper: DATABASE_URL is not set");
  }

  client ??= postgres(connectionString, {
    max: 4,
    idle_timeout: 20,
    // Neon terminates TLS itself; the URL already says sslmode=require.
    prepare: false,
  });

  return client;
}

/**
 * Creates the tables on first use.
 *
 * `if not exists` keeps this safe to run from several request handlers at once
 * and from every process start; there is no migration history to get wrong.
 */
async function createSchema(): Promise<void> {
  const db = sql();

  await db`
    create table if not exists pp_users (
      id uuid primary key,
      email text not null unique,
      name text not null,
      picture text,
      google_sub text,
      created_at timestamptz not null default now()
    )
  `;

  // Databases created before Google sign-in have a password column and no
  // Google ids. Every statement below is a no-op on a database that already
  // has the current shape, so this runs on each cold start without a
  // migration table to keep in sync.
  await db`alter table pp_users add column if not exists picture text`;
  await db`alter table pp_users add column if not exists google_sub text`;
  await db`
    create unique index if not exists pp_users_google on pp_users (google_sub)
    where google_sub is not null
  `;
  await db`alter table pp_users drop column if exists password_hash`;

  await db`
    create table if not exists pp_sessions (
      token_hash text primary key,
      user_id uuid not null references pp_users(id) on delete cascade,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null
    )
  `;
  await db`create index if not exists pp_sessions_user on pp_sessions (user_id)`;

  await db`
    create table if not exists pp_boards (
      id text primary key,
      owner_id uuid not null references pp_users(id) on delete cascade,
      title text not null,
      content jsonb not null,
      seq integer not null default 0,
      updated_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      deleted_at timestamptz
    )
  `;
  await db`create index if not exists pp_boards_owner on pp_boards (owner_id, updated_at desc)`;

  await db`
    create table if not exists pp_share_links (
      token_hash text primary key,
      board_id text not null references pp_boards(id) on delete cascade,
      role text not null check (role in ('editor', 'viewer')),
      created_by uuid not null references pp_users(id) on delete cascade,
      created_at timestamptz not null default now(),
      expires_at timestamptz,
      revoked_at timestamptz
    )
  `;
  await db`create index if not exists pp_share_links_board on pp_share_links (board_id)`;
}

/** Runs the schema once per process. */
export function ready(): Promise<void> {
  schema ??= createSchema().catch((error) => {
    // A failed create must be retried on the next request rather than cached
    // forever, or a cold Neon wake would poison the whole process.
    schema = null;
    throw error;
  });

  return schema;
}
