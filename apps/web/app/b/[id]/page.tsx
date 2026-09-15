import { BoardScreen } from "@/components/BoardScreen";

/**
 * One board per route. `/b/local` is the offline board; Task 13 adds hydration
 * and persistence keyed by this id.
 */
export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BoardScreen boardId={id} />;
}
