/**
 * Playlist order keys (docs/spec.md, "Wave account and sync"): each playlist
 * entry carries a key, and the playlist lists its entries by key, so adding
 * or moving one entry changes that entry's row only. Keys are short strings
 * that sort as text (code-unit order, SQLite's `BINARY` collation).
 *
 * A key is a head letter that says how many digits follow it (`a`–`z`: 1–26,
 * `Z`–`A`: 1–26 for the keys before those), those digits, and a fraction that
 * never ends in `0`. Adding at the end or the top steps the head and its
 * digits, so thousands of songs added one after the other keep keys of three
 * or four characters; adding between two keys extends the fraction.
 *
 * Two phones adding at the same place offline make the same key; both entries
 * stay, and `compareOrderKeys` sorts them one after the other by entry id.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = "0";
const LAST_DIGIT = "z";
/** The smallest head and digits: nothing can go before it, so no key is just this. */
const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`;

const digitAt = (text: string, index: number): number => DIGITS.indexOf(text[index] ?? ZERO);

/** How many characters the head [head] and its digits take, or `null` for no head. */
const integerLength = (head: string): number | null => {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
  if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
  return null;
};

const invalid = (key: string): RangeError => new RangeError(`Not a playlist order key: "${key}"`);

/** Splits a key into its head with digits and its fraction, refusing what isn't a key. */
const splitKey = (key: string): { readonly integer: string; readonly fraction: string } => {
  const length = integerLength(key.charAt(0));
  if (length === null || length > key.length || key === SMALLEST_INTEGER) throw invalid(key);
  const integer = key.slice(0, length);
  const fraction = key.slice(length);
  for (const digit of key.slice(1)) if (!DIGITS.includes(digit)) throw invalid(key);
  if (fraction.endsWith(ZERO)) throw invalid(key);
  return { integer, fraction };
};

/**
 * A fraction between fractions [a] and [b] (`null`: no upper bound), read as
 * base-62 digits after the point. Neither ends in `0`, and [a] < [b].
 */
const fractionBetween = (a: string, b: string | null): string => {
  if (b !== null) {
    let shared = 0;
    while ((a[shared] ?? ZERO) === b[shared]) shared++;
    if (shared > 0) return b.slice(0, shared) + fractionBetween(a.slice(shared), b.slice(shared));
  }
  const low = a === "" ? 0 : digitAt(a, 0);
  const high = b === null ? DIGITS.length : digitAt(b, 0);
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)] ?? ZERO;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return (DIGITS[low] ?? ZERO) + fractionBetween(a.slice(1), null);
};

/** The next head with digits after [integer], or `null` past the last. */
const incrementInteger = (integer: string): string | null => {
  const head = integer.charAt(0);
  const digits = integer.slice(1).split("");
  for (let i = digits.length - 1; i >= 0; i--) {
    const next = DIGITS.indexOf(digits[i] ?? ZERO) + 1;
    if (next < DIGITS.length) {
      digits[i] = DIGITS[next] ?? ZERO;
      return head + digits.join("");
    }
    digits[i] = ZERO;
  }
  if (head === "Z") return `a${ZERO}`;
  if (head === "z") return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > "a") digits.push(ZERO);
  else digits.pop();
  return nextHead + digits.join("");
};

/** The head with digits before [integer], or `null` before the first. */
const decrementInteger = (integer: string): string | null => {
  const head = integer.charAt(0);
  const digits = integer.slice(1).split("");
  for (let i = digits.length - 1; i >= 0; i--) {
    const previous = DIGITS.indexOf(digits[i] ?? ZERO) - 1;
    if (previous >= 0) {
      digits[i] = DIGITS[previous] ?? ZERO;
      return head + digits.join("");
    }
    digits[i] = LAST_DIGIT;
  }
  if (head === "a") return `Z${LAST_DIGIT}`;
  if (head === "A") return null;
  const previousHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (previousHead < "Z") digits.push(LAST_DIGIT);
  else digits.pop();
  return previousHead + digits.join("");
};

const exhausted = (): RangeError => new RangeError("No playlist order key is left on that side");

/**
 * A playlist order key that sorts (as text) after [before] and before
 * [after]; `null` for either means the start or the end of the playlist, and
 * both `null` gives the first key of an empty playlist. Throws a `RangeError`
 * when [before] isn't below [after] or either isn't a key this made.
 */
export const orderKeyBetween = (before: string | null, after: string | null): string => {
  const low = before === null ? null : splitKey(before);
  const high = after === null ? null : splitKey(after);
  if (before !== null && after !== null && before >= after) {
    throw new RangeError(`"${before}" isn't before "${after}"`);
  }
  if (low === null) {
    if (high === null || after === null) return `a${ZERO}`;
    if (high.integer === SMALLEST_INTEGER) return high.integer + fractionBetween("", high.fraction);
    if (high.fraction !== "") return high.integer;
    const previous = decrementInteger(high.integer);
    if (previous === null) throw exhausted();
    return previous;
  }
  if (high === null || after === null) {
    const next = incrementInteger(low.integer);
    return next ?? low.integer + fractionBetween(low.fraction, null);
  }
  if (low.integer === high.integer) {
    return low.integer + fractionBetween(low.fraction, high.fraction);
  }
  const next = incrementInteger(low.integer);
  if (next !== null && next < after) return next;
  return low.integer + fractionBetween(low.fraction, null);
};

/** A playlist entry as its order sees it. */
export interface OrderedEntry {
  readonly id: string;
  readonly orderKey: string;
}

/**
 * The order a playlist lists its entries in: by order key, then by entry id
 * for the entries two phones gave one key (both compared as text, as SQLite's
 * `ORDER BY order_key, id` does).
 */
export const compareOrderKeys = (a: OrderedEntry, b: OrderedEntry): number => {
  if (a.orderKey !== b.orderKey) return a.orderKey < b.orderKey ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
};
