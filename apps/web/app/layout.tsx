import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PenPaper — a whiteboard that keeps up with you",
  description:
    "An infinite canvas for sketches, diagrams, and notes. Draw with a pen, a finger, or a mouse, and pick up on any device where you left off.",
  applicationName: "PenPaper",
  appleWebApp: {
    capable: true,
    title: "PenPaper",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Let the canvas reach the edges of a notched phone without clipping.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#121212" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-[100dvh] overflow-hidden overscroll-none">{children}</body>
    </html>
  );
}
