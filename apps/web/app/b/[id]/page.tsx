import { BoardLoader } from "@/components/BoardLoader";

/**
 * One board per route. `/b/local` is the offline board; the id namespaces the
 * IndexedDB snapshot, and Task 13's loader hydrates it before the canvas mounts.
 */
export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BoardLoader boardId={id} />;
}
