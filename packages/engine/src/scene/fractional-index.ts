/**
 * Fractional z-order keys.
 *
 * Paint order is the lexicographic order of `Element.index`. Inserting between
 * two elements means generating a key that sorts strictly between their keys,
 * so a reorder touches exactly one element instead of rewriting the whole
 * z-order — which is what makes concurrent renaming and reordering merge
 * cleanly under Yjs.
 *
 * Base-62, and the digit alphabet is in ASCII order on purpose: `"0" < "9" <
 * "A" < "Z" < "a" < "z"`, so a plain `<` on strings matches key order. No
 * localeCompare in the hot path, and no surprises on Android.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

function digitValue(digit: string): number {
  const value = DIGITS.indexOf(digit);
  if (value === -1) throw new Error(`fractional-index: invalid digit "${digit}"`);
  return value;
}

/**
 * Returns a key strictly between `a` and `b`.
 * `null` means "no neighbour on that side", i.e. -Infinity / +Infinity.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) {
    throw new Error(`fractional-index: need a < b, got "${a}" >= "${b}"`);
  }
  if (a.endsWith("0")) {
    throw new Error(`fractional-index: keys must not end in "0" ("${a}")`);
  }

  // Share the common prefix, then find a midpoint in the remaining suffix.
  if (b !== null) {
    let common = 0;
    while ((a[common] ?? "0") === b[common]) common += 1;
    if (common > 0) {
      return b.slice(0, common) + midpoint(a.slice(common), b.slice(common));
    }
  }

  const low = a.length > 0 ? digitValue(a[0] as string) : 0;
  const high = b !== null ? digitValue(b[0] as string) : BASE;

  if (high - low > 1) {
    return DIGITS[Math.round((low + high) / 2)] as string;
  }

  // Digits are adjacent (or `b` is unbounded). Borrow one digit from the right.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return (DIGITS[low] as string) + midpoint(a.slice(1), null);
}

/**
 * The canonical "insert here" call.
 *
 * - `indexBetween(null, null)` → the first element in an empty board.
 * - `indexBetween(last, null)` → send to front.
 * - `indexBetween(null, first)` → send to back.
 * - `indexBetween(a, b)` → insert between two neighbours.
 */
export function indexBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`fractional-index: neighbours out of order ("${a}" >= "${b}")`);
  }
  if (a === null) return midpoint("", b);
  return midpoint(a, b);
}
