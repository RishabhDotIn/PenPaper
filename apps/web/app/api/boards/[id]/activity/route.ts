import type { ActivityItem } from "@/lib/activity";
import { currentUser } from "@/lib/server/auth";
import { getBoard } from "@/lib/server/boards";
import { databaseConfigured, ready, sql } from "@/lib/server/db";
import { eventsEnabled } from "../../../../../server/events.mjs";
import { fail, ok } from "@/lib/server/http";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * The last few things that happened to this board.
 *
 * Read-only and deliberately short: it answers "who touched this lately", not
 * "show me the history". The rows are written by the worker from the event
 * topic, so a deployment without a broker reports an empty list and the menu
 * leaves the line out.
 */
export async function GET(request: Request, context: RouteContext) {
  if (!databaseConfigured) return fail(503, "Accounts are not configured on this server");

  const { id } = await context.params;
  const share = new URL(request.url).searchParams.get("share");

  const user = await currentUser().catch(() => null);
  const found = await getBoard(id, user?.id ?? null, share);
  if (!found) return fail(404, "That notepad is not available");

  if (!eventsEnabled()) return ok({ enabled: false, events: [] as ActivityItem[] });

  await ready();
  const rows = await sql()`
    select type, actor_name, role, detail, created_at
    from pp_board_events
    where board_id = ${id}
    order by created_at desc
    limit 6
  `;

  const events: ActivityItem[] = rows.map((row) => ({
    type: row.type as string,
    actorName: row.actor_name as string,
    role: (row.role as string | null) ?? null,
    detail: (row.detail as string | null) ?? null,
    at: (row.created_at as Date).toISOString(),
  }));

  return ok({ enabled: true, events });
}
