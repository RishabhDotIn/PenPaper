import { SignJWT } from "jose";
import type { Role } from "./boards";

/**
 * The five-minute token the socket service accepts.
 *
 * Minting it here means the socket process never reads the database and never
 * trusts the client: it verifies the signature, the expiry, and that the board
 * in the payload is the room being joined.
 */

export const collabConfigured = Boolean(process.env.PENPAPER_SECRET?.trim());

function secret(): Uint8Array {
  const value = process.env.PENPAPER_SECRET?.trim();
  if (!value) throw new Error("PenPaper: PENPAPER_SECRET is not set");
  return new TextEncoder().encode(value);
}

export interface CollabClaims {
  boardId: string;
  userId: string;
  role: Role;
  name: string;
  color: string;
}

/** A stable, readable colour per identity; no palette needed on the client. */
export function colorFor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 72% 48%)`;
}

const GUEST_ANIMALS = [
  "Otter",
  "Heron",
  "Marmot",
  "Finch",
  "Lynx",
  "Panda",
  "Gecko",
  "Raven",
  "Bison",
  "Koala",
];

export function guestName(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 17 + id.charCodeAt(index)) >>> 0;
  }
  return `Guest ${GUEST_ANIMALS[hash % GUEST_ANIMALS.length]}`;
}

export async function signCollabToken(claims: CollabClaims): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const token = await new SignJWT({
    board: claims.boardId,
    role: claims.role,
    name: claims.name,
    color: claims.color,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(secret());

  return { token, expiresAt };
}
