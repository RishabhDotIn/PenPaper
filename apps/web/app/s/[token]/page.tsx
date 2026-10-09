import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveShare } from "@/lib/server/boards";
import { databaseConfigured } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/**
 * A share link is a short address, not a second app.
 *
 * Resolving it here means the board itself never has to know a token was in the
 * address bar, and the redirect carries the token to `/b/<id>` so reloads and
 * every save keep the same authorization.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!databaseConfigured) {
    return <ShareMessage title="Sharing is not set up here" copy="This deployment has no account service, so links cannot be opened." />;
  }

  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    return <ShareMessage title="This link is not valid" copy="Ask the person who shared it for a fresh one." />;
  }

  let boardId: string | null = null;
  try {
    const target = await resolveShare(token);
    boardId = target?.boardId ?? null;
  } catch (error) {
    // Neon waking up, or a network blip. A retry is honest; a 500 is not.
    console.warn("PenPaper: could not resolve a share link", error);
    return <ShareMessage title="Could not open this link" copy="PenPaper could not reach its server. Try again in a moment." />;
  }

  if (!boardId) {
    return <ShareMessage title="This link has expired" copy="The owner turned it off, or it was replaced by a newer link." />;
  }

  redirect(`/b/${encodeURIComponent(boardId)}?share=${encodeURIComponent(token)}`);
}

function ShareMessage({ title, copy }: { title: string; copy: string }) {
  return (
    <main
      className="grid h-[100dvh] w-full place-items-center p-5"
      style={{ background: "var(--surface-lowest)", color: "var(--on-surface)" }}
    >
      <section
        className="w-full max-w-[380px] rounded-3xl p-6"
        style={{
          background: "var(--glass-tint)",
          boxShadow: "var(--glass-shadow)",
        }}
        aria-labelledby="share-message-title"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--primary)" }}>
          PenPaper
        </p>
        <h1 id="share-message-title" className="mt-2 text-xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--on-surface-muted)" }}>
          {copy}
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold"
          style={{ background: "var(--primary)", color: "var(--on-primary)" }}
        >
          Open PenPaper
        </Link>
      </section>
    </main>
  );
}
