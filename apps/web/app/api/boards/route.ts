import { currentUser } from "@/lib/server/auth";
import {
  createBoard,
  looksLikeContent,
  MAX_CONTENT_BYTES,
  listBoards,
  type BoardContent,
} from "@/lib/server/boards";
import { databaseConfigured } from "@/lib/server/db";
import { emitBoardEvent } from "@/lib/server/events";
import {
  allowRequest,
  cleanBoardId,
  cleanTitle,
  fail,
  ok,
  readJson,
} from "@/lib/server/http";

export const runtime = "nodejs";

interface CreateBody {
  id?: unknown;
  title?: unknown;
  content?: unknown;
}

/** The notepads this account owns. */
export async function GET() {
  if (!databaseConfigured) return fail(503, "Accounts are not configured on this server");

  const user = await currentUser().catch(() => null);
  if (!user) return fail(401, "Sign in to open your library");

  return ok({ boards: await listBoards(user.id) });
}

/**
 * Registers a board.
 *
 * The id comes from the device so the first upload keeps the URL the person
 * already has; `on conflict do nothing` in `createBoard` makes opening an
 * existing notepad from a second tab harmless.
 */
export async function POST(request: Request) {
  if (!databaseConfigured) return fail(503, "Accounts are not configured on this server");

  const user = await currentUser().catch(() => null);
  if (!user) return fail(401, "Sign in to save notepads to your account");

  // A device uploads its library when it first signs in, which is a burst of
  // creates. The limit is per account and generous enough for that, and small
  // enough that a script cannot fill the database in a minute.
  if (!(await allowRequest(`boards:new:${user.id}`, 40, 60_000))) {
    return fail(429, "Too many new notepads. Try again in a minute.");
  }

  const body = await readJson<CreateBody>(request);
  const id = cleanBoardId(body?.id);
  if (!id) return fail(400, "That notepad id is not valid");

  if (body?.content !== undefined && !looksLikeContent(body.content)) {
    return fail(400, "That notepad is not a valid drawing");
  }

  const content = (body?.content ?? { version: 1, elements: [] }) as BoardContent;
  if (JSON.stringify(content).length > MAX_CONTENT_BYTES) {
    return fail(413, "That notepad is too large to save");
  }

  try {
    const board = await createBoard({
      id,
      ownerId: user.id,
      title: cleanTitle(body?.title),
      content,
    });
    emitBoardEvent({
      type: "board.created",
      boardId: board.id,
      actorId: user.id,
      actorName: user.name,
      role: "owner",
      detail: board.title,
    });
    return ok({ board }, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already in use")) {
      return fail(409, "That notepad belongs to another account");
    }
    throw error;
  }
}
