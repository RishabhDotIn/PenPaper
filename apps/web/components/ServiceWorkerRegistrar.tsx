"use client";

import { useEffect } from "react";

/**
 * Registers the service worker after hydration, never during it.
 *
 * Registration is production-only by default so `next dev` and the e2e suite
 * never serve yesterday's chunk from a cache. `?sw=1` opts in, which is what
 * the PWA test uses to prove the worker actually installs.
 *
 * The worker is also the app's update channel. A page that was already
 * controlled by an older worker keeps running the JavaScript it loaded with —
 * navigation is network-first, but a live tab never re-fetches its chunks on
 * its own, so menu changes could sit invisible for as long as the tab stays
 * open. When a new worker takes over, this page is running yesterday's build:
 * mark it stale and swap it out the next time the person leaves the tab, so a
 * half-drawn stroke is never thrown away mid-gesture.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const dev = process.env.NODE_ENV !== "production";
    const optedIn = new URLSearchParams(window.location.search).has("sw");
    if (dev && !optedIn) return;

    // First install also fires `controllerchange` (the worker claims this
    // page). That page already has the current build, so only a replaced
    // controller means stale JavaScript.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let staleBuild = false;
    let registration: ServiceWorkerRegistration | undefined;

    const swapWhenHidden = () => {
      if (staleBuild && document.visibilityState === "hidden") {
        window.location.reload();
      }
    };

    const onControllerChange = () => {
      if (!hadController) return;
      staleBuild = true;
      swapWhenHidden();
    };

    const checkForUpdate = () => {
      if (document.visibilityState !== "visible") return;
      void registration?.update().catch(() => undefined);
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registered) => {
        registration = registered;
      })
      .catch((error: unknown) => {
        // A blocked or unsupported worker costs offline support, not the app.
        console.warn("PenPaper: service worker registration failed", error);
      });

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    // A tab that has been open for days still asks for a new worker when it
    // comes back, instead of waiting for the browser's own daily check.
    document.addEventListener("visibilitychange", checkForUpdate);
    document.addEventListener("visibilitychange", swapWhenHidden);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", checkForUpdate);
      document.removeEventListener("visibilitychange", swapWhenHidden);
    };
  }, []);

  return null;
}
