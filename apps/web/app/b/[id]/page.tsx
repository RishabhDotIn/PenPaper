import { BoardLoader } from "@/components/BoardLoader";

/**
 * One board per route. `/b/local` is the offline board; the id namespaces the
 * IndexedDB snapshot, and the loader hydrates it before the canvas mounts.
 *
 * `?share=<token>` is the guest's invitation: the loader resolves it before the
 * canvas exists, so a read-only visitor never gets a writable first frame.
 */
export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ share?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const raw = Array.isArray(query.share) ? query.share[0] : query.share;

  // A malformed token is not an error page: the board still opens locally for
  // its owner, and a guest simply has no invitation.
  const shareToken = raw && /^[A-Za-z0-9_-]{16,128}$/.test(raw) ? raw : null;

  return <BoardLoader boardId={id} shareToken={shareToken} />;
}
