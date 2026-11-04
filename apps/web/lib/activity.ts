/**
 * One line of board activity, and the words for it.
 *
 * The type is shared by the route that reads the rows and the menu that shows
 * them, so the two cannot drift on a field name. `describe` is where the
 * sentence lives: the server stores facts, the interface decides phrasing.
 */

export interface ActivityItem {
  type: string;
  actorName: string;
  role: string | null;
  detail: string | null;
  at: string;
}

/** What the board menu shows for one event. Unknown types are not shown. */
export function describeActivity(item: ActivityItem): string | null {
  const who = item.actorName;

  switch (item.type) {
    case "board.created":
      return `${who} started this notepad`;
    case "board.saved":
      return `${who} saved changes`;
    case "share.minted":
      return item.detail === "viewer"
        ? `${who} opened a view-only link`
        : `${who} opened an editing link`;
    case "share.revoked":
      return `${who} turned sharing off`;
    case "room.opened":
      return `${who} joined the room`;
    case "member.removed":
      return `${who} removed ${item.detail ?? "a guest"}`;
    default:
      // `board.deleted` never reaches a board that still exists, and a type
      // from a newer deployment is better dropped than shown as a raw id.
      return null;
  }
}

/** "2 minutes ago", for a timestamp the server has already validated. */
export function relativeTime(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1_000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
