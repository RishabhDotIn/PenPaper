"use client";

import { useEffect } from "react";

/**
 * Registers the service worker after hydration, never during it.
 *
 * Registration is production-only by default so `next dev` and the e2e suite
 * never serve yesterday's chunk from a cache. `?sw=1` opts in, which is what
 * the PWA test uses to prove the worker actually installs.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const dev = process.env.NODE_ENV !== "production";
    const optedIn = new URLSearchParams(window.location.search).has("sw");
    if (dev && !optedIn) return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => {
        // A blocked or unsupported worker costs offline support, not the app.
        console.warn("PenPaper: service worker registration failed", error);
      });
  }, []);

  return null;
}
