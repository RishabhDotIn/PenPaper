/**
 * Google Identity Services, loaded once per page.
 *
 * Two features use it: Drive sync asks for an access token, and signing in
 * asks for an ID token. Both are popups hosted by Google, both need the same
 * public client id, and both should not fetch the script twice.
 */

const GIS_SRC = "https://accounts.google.com/gsi/client";

/** The public client id. Not a secret: it is in the page anyway. */
export function googleClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";
}

export function googleConfigured(): boolean {
  const id = googleClientId();
  // The same shape check Drive uses: a truncated or placeholder value must
  // read as "not set up", not as a network failure on every sign-in attempt.
  return id.endsWith(".apps.googleusercontent.com") && id.length > 30;
}

export interface GoogleCredentialResponse {
  credential?: string;
}

/**
 * The slice of `google.accounts.id` PenPaper uses.
 *
 * Written out rather than pulled from a types package: the surface is two
 * calls, and a dependency has to be kept in step with Google's script.
 */
export interface GoogleIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    ux_mode?: "popup" | "redirect";
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type?: "standard" | "icon";
      theme?: "outline" | "filled_blue" | "filled_black";
      size?: "large" | "medium" | "small";
      text?: "signin_with" | "signup_with" | "continue_with" | "signin";
      shape?: "rectangular" | "pill" | "circle" | "square";
      logo_alignment?: "left" | "center";
      width?: number;
    },
  ): void;
}

interface GoogleGlobal {
  accounts?: {
    id?: GoogleIdApi;
    oauth2?: { initTokenClient: unknown; revoke: unknown };
  };
}

function google(): GoogleGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { google?: GoogleGlobal }).google;
}

/** `google.accounts.id`, or null before the script has loaded. */
export function googleId(): GoogleIdApi | null {
  return google()?.accounts?.id ?? null;
}

let script: Promise<void> | null = null;

/**
 * Resolves once either API is available.
 *
 * Reuses a tag that is already on the page, so a Drive connect and a sign-in
 * cannot race into two copies of the GIS script.
 */
export function loadGisScript(): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Google sign-in needs a browser"));
  }

  const live = google();
  if (live?.accounts?.id || live?.accounts?.oauth2) return Promise.resolve();

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
