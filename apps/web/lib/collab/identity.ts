/**
 * A stable name for a browser that is not signed in.
 *
 * A share link can be opened on a phone with no account, and live presence
 * still needs to tell two guests apart. The value is random and local: it
 * identifies a browser, not a person, and the server turns it into a friendly
 * animal name.
 */

const GUEST_KEY = "penpaper:guest:v1";

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function guestId(): string {
  try {
    const existing = localStorage.getItem(GUEST_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;

    const created = randomId();
    localStorage.setItem(GUEST_KEY, created);
    return created;
  } catch {
    // Private mode still gets a working session for this page's lifetime.
    return randomId();
  }
}
