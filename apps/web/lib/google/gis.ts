/**
 * Google Identity Services, loaded once per page.
 *
 * PenPaper runs one Google consent — identity plus Drive — through the OAuth
 * token client, so this module only has to hand the script over and describe
 * the client id. Both were loaded twice in an earlier life; a single loader
 * keeps a connect and a sign-in from racing into two copies of the script.
 */

const GIS_SRC = "https://accounts.google.com/gsi/client";

/** The public client id. Not a secret: it is in the page anyway. */
export function googleClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";
}

interface GoogleGlobal {
  accounts?: {
    oauth2?: { initTokenClient: unknown; revoke: unknown };
  };
}

function google(): GoogleGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { google?: GoogleGlobal }).google;
}

let script: Promise<void> | null = null;

/** Resolves once the GIS script is on the page and its API is callable. */
export function loadGisScript(): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Google sign-in needs a browser"));
  }

  const live = google();
  if (live?.accounts?.oauth2) return Promise.resolve();

  script ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const element = existing ?? document.createElement("script");

    element.addEventListener("load", () => resolve(), { once: true });
    element.addEventListener(
      "error",
      () => {
        script = null;
        // Leave no half-loaded tag behind: a retry must be able to load it.
        element.remove();
        reject(new Error("Could not reach Google sign-in"));
      },
      { once: true },
    );

    if (!existing) {
      element.src = GIS_SRC;
      element.async = true;
      element.defer = true;
      document.head.append(element);
    }
  });

  return script;
}
