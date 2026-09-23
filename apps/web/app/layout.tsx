import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import "./globals.css";
import "@penpaper/ui/styles.css";

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
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
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
    <html lang="en" suppressHydrationWarning>
      <body className="h-[100dvh] overflow-hidden overscroll-none">
        {/* Resolve the saved theme before the first paint. Without this the
            board paints light for a frame and then snaps to dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var p=JSON.parse(localStorage.getItem("penpaper:prefs:v1")||"null");var t=p&&p.theme;if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}',
          }}
        />
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
