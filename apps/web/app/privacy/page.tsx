import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy — PenPaper",
  description:
    "What PenPaper stores, where it stores it, and how to delete it. No ads, no analytics, no trackers.",
};

/*
 * The privacy policy is a page, not a modal: Google's OAuth consent screen
 * needs a stable public URL to link, and this is the page a user lands on when
 * they want to know what happens to their board. It is a server component with
 * no client JavaScript, so it opens instantly even on a cold, sleeping server.
 */

export default function PrivacyPage() {
  return (
    <main className="h-[100dvh] overflow-y-auto">
      <div
        className="min-h-full px-[clamp(16px,5vw,48px)] py-[clamp(32px,8vh,96px)]"
        style={{
          backgroundColor: "var(--surface-lowest)",
          backgroundImage:
            "radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--on-surface) 9%, transparent) 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      >
        <article
          className="mx-auto max-w-[68ch] rounded-[var(--radius-island)] px-[clamp(20px,4vw,40px)] py-[clamp(24px,4vw,40px)]"
          style={{
            backgroundColor: "var(--island-bg)",
            boxShadow: "var(--shadow-island)",
            color: "var(--on-surface)",
          }}
        >
          <Link
            href="/"
            className="text-sm font-medium"
            style={{ color: "var(--primary)" }}
          >
            ← PenPaper
          </Link>

          <h1 className="mt-6 text-[clamp(28px,5vw,38px)] font-semibold tracking-[-0.02em]">
            Privacy policy
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--on-surface-muted)" }}>
            Last updated 1 November 2026
          </p>

          <p className="mt-8 text-[17px] leading-relaxed">
            PenPaper is a whiteboard. It stores your drawings on your own device
            first, and it only talks to a server when you sign in, share a board,
            or turn on Google Drive sync. There are no ads, no analytics, and no
            trackers of any kind.
          </p>

          <Section title="What is stored on your device">
            <p>
              Every board, its name, and the camera position are written to
              IndexedDB in your browser, along with a small preferences record in
              local storage (theme, paper style, last opened board). This data
              never leaves the device unless you sign in. Clearing site data for
              PenPaper removes all of it.
            </p>
          </Section>

          <Section title="What is stored when you sign in">
            <p>
              Signing in uses Google. PenPaper receives your Google account
              identifier, your email address, your display name, and your profile
              picture URL, and keeps them in a Postgres database so the same
              notepads can follow you between devices. A board snapshot is saved
              there too, debounced while you draw.
            </p>
            <p>
              Your session is a random token held in an{" "}
              <code>httpOnly</code> cookie. PenPaper stores only its SHA-256
              hash, so the database cannot be turned back into a usable cookie.
              There are no passwords anywhere in the system.
            </p>
          </Section>

          <Section title="Google Drive is optional">
            <p>
              If you connect Drive, PenPaper asks for the{" "}
              <code>drive.file</code> scope, which only grants access to files
              this app creates. It never sees the rest of your Drive. Each
              notepad becomes one JSON file inside a{" "}
              <code>PenPaper</code> folder, and the browser talks to Google
              directly: no Drive traffic passes through PenPaper&apos;s server,
              and no refresh token is kept.
            </p>
            <p>
              PenPaper&apos;s use of information received from Google APIs
              adheres to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--primary)" }}
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. Google user data is used
              only to provide the features described here; it is not sold, not
              used for advertising, and not read by anyone.
            </p>
          </Section>

          <Section title="Sharing a board">
            <p>
              A share link carries a random token. The server keeps only its
              hash, together with the board it opens and the role it grants, so
              revoking a link is immediate. Anyone holding a live link can open
              that board; treat the link as the invitation. While a room is
              open, edits pass through a live server in memory and are not kept
              after the last person leaves, apart from the usual board snapshot.
            </p>
          </Section>

          <Section title="What is never done">
            <ul className="ml-5 list-disc space-y-1.5">
              <li>No selling of data, and no sharing with third parties.</li>
              <li>No advertising identifiers, profiling, or tracking pixels.</li>
              <li>No reading of your Gmail, Calendar, or other Google content.</li>
              <li>No access to files in Drive that PenPaper did not create.</li>
            </ul>
          </Section>

          <Section title="Deleting your data">
            <p>
              Delete a notepad from the board menu to remove it from the device
              and, when signed in, from the server. Deleting the{" "}
              <code>PenPaper</code> folder in Drive removes the Drive copies.
              Signing out clears the session cookie; clearing site data removes
              everything held locally.
            </p>
            <p>
              To have your account and its stored boards deleted entirely, email{" "}
              <a href="mailto:iamekaiva@gmail.com" style={{ color: "var(--primary)" }}>
                iamekaiva@gmail.com
              </a>{" "}
              and they will be removed.
            </p>
          </Section>

          <Section title="Changes and contact">
            <p>
              If this policy changes, the date at the top changes with it.
              Questions about anything on this page can go to{" "}
              <a href="mailto:iamekaiva@gmail.com" style={{ color: "var(--primary)" }}>
                iamekaiva@gmail.com
              </a>
              .
            </p>
          </Section>
        </article>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-[-0.01em]">{title}</h2>
      <div
        className="mt-3 space-y-3 text-[16px] leading-relaxed"
        style={{ color: "var(--on-surface-muted)" }}
      >
        {children}
      </div>
    </section>
  );
}
