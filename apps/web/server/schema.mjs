/**
 * Tables the event pipeline and the API both need to agree on.
 *
 * Plain `.mjs` on purpose: the API route handlers (TypeScript, bundled by
 * Next) and the separate worker process (plain Node, never bundled) both read
 * this file, so the shape of the table has exactly one definition. Import it,
 * do not retype it.
 */

export const BOARD_EVENTS_DDL = `
  create table if not exists pp_board_events (
    id uuid primary key,
    board_id text not null,
    type text not null,
    actor_id uuid,
    actor_name text not null,
    role text,
    detail text,
    created_at timestamptz not null default now()
  )
`;

export const BOARD_EVENTS_INDEXES = [
  `create index if not exists pp_board_events_board on pp_board_events (board_id, created_at desc)`,
  `create index if not exists pp_board_events_recent on pp_board_events (created_at desc)`,
];
