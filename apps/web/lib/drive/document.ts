import type { Element } from "@penpaper/shared";

/**
 * The file PenPaper writes to Drive.
 *
 * Deliberately not the IndexedDB snapshot: the camera is per device (a phone
 * should not inherit a laptop's zoom), and the Drive bookkeeping is per device
 * too. What travels is the drawing and the name — everything two devices can
 * disagree about without losing work.
 */
export interface DriveBoardDocument {
  format: "penpaper.board";
  version: 1;
  boardId: string;
  title: string;
  savedAt: number;
  elements: Element[];
}

export const BOARD_FILE_MIME = "application/json";
export const BOARD_FILE_SUFFIX = ".penpaper.json";
export const DRIVE_FOLDER_NAME = "PenPaper";

export function boardFileName(title: string): string {
  // Drive names allow almost anything, but slashes are path separators in
  // exports and quote marks survive badly in Content-Disposition.
  const safe = title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return `${safe.slice(0, 120) || "Untitled notepad"}${BOARD_FILE_SUFFIX}`;
}

export function titleFromFileName(name: string): string {
  return name.endsWith(BOARD_FILE_SUFFIX)
    ? name.slice(0, -BOARD_FILE_SUFFIX.length)
    : name;
}

export function isBoardDocument(value: unknown): value is DriveBoardDocument {
  if (typeof value !== "object" || value === null) return false;
  const doc = value as Partial<DriveBoardDocument>;
  return (
    doc.format === "penpaper.board" &&
    typeof doc.boardId === "string" &&
    Array.isArray(doc.elements)
  );
}

/**
 * Last-writer-wins, one element at a time.
 *
 * The two devices that can reach the same file are the same person's, so the
 * honest promise is "no edits disappear, and the newest version of each shape
 * wins". Elements carry `updatedAt` and deletions are tombstones, so a merge is
 * a union by id: a shape deleted on the phone stays deleted against an older
 * edit of it, and a shape drawn on the laptop while the phone was offline
 * arrives intact. Field-level merging across devices would need the CRDT from
 * the collab path; for a file that is only ever written by one person at a
 * time, that ceremony buys nothing.
 */
export function mergeElements(local: readonly Element[], remote: readonly Element[]): Element[] {
  const byId = new Map<string, Element>();

  for (const element of remote) byId.set(element.id, element);

  for (const element of local) {
    const other = byId.get(element.id);
    if (!other) {
      byId.set(element.id, element);
      continue;
    }
    // Ties happen when the same edit was pushed twice; either copy is that
    // edit, so keep the local one and avoid a pointless write.
    if (element.updatedAt >= other.updatedAt) byId.set(element.id, element);
  }

  return [...byId.values()];
}

/** True when merging would change the local drawing. */
export function mergeChanges(
  local: readonly Element[],
  merged: readonly Element[],
): boolean {
  if (local.length !== merged.length) return true;
  const byId = new Map(local.map((element) => [element.id, element]));
  for (const element of merged) {
    const current = byId.get(element.id);
    if (!current || current.updatedAt !== element.updatedAt) return true;
  }
  return false;
}
