/**
 * Browsing rules for the Library's lists and detail screens: the letter a row
 * is filed under on the A–Z spine, which of an artist's albums are their own,
 * and the order of a folder's files.
 */

/**
 * The spine letter for a Core sort key: `A`–`Z`, or `#` for names that start
 * with a digit, a symbol or a non-Latin letter.
 */
export const indexLetter = (sortKey: string): string => {
  const first = sortKey.charAt(0);
  return first >= "a" && first <= "z" ? first.toUpperCase() : "#";
};

/** One letter on the A–Z spine and the first row filed under it. */
export interface IndexEntry {
  readonly letter: string;
  readonly index: number;
}

/** The spine for a list ordered by sort key: each letter present, with its first row. */
export const alphabetIndex = (sortKeys: readonly string[]): readonly IndexEntry[] => {
  const entries: IndexEntry[] = [];
  const seen = new Set<string>();
  sortKeys.forEach((key, index) => {
    const letter = indexLetter(key);
    if (seen.has(letter)) return;
    seen.add(letter);
    entries.push({ letter, index });
  });
  return entries;
};

/** What `artistAlbums` needs to know about an album. */
export interface ArtistAlbum {
  readonly albumArtistId: number;
  readonly year: number | null;
  readonly titleSort: string;
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Newest first; undated albums after the dated ones; then by title. */
const compareByRelease = (a: ArtistAlbum, b: ArtistAlbum): number =>
  (b.year ?? Number.MIN_SAFE_INTEGER) - (a.year ?? Number.MIN_SAFE_INTEGER) ||
  compareStrings(a.titleSort, b.titleSort);

/**
 * Splits the albums an artist has tracks on (or is filed under) into their own
 * albums, filed under them as album artist, and the albums they appear on
 * (compilations, other artists' records). Both newest first.
 */
export const artistAlbums = <A extends ArtistAlbum>(
  artistId: number,
  albums: readonly A[],
): { readonly albums: readonly A[]; readonly appearsOn: readonly A[] } => {
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
  const sorted = [...albums].sort(compareByRelease);
  return {
    albums: sorted.filter((album) => album.albumArtistId === artistId),
    appearsOn: sorted.filter((album) => album.albumArtistId !== artistId),
  };
};

const fold = (name: string): string => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

const chunks = (name: string): string[] => fold(name).match(/\d+|\D+/g) ?? [];

const isDigits = (chunk: string): boolean => chunk.charCodeAt(0) >= 48 && chunk.charCodeAt(0) <= 57;

/** Compares digit runs by value, however long: fewer significant digits is smaller. */
const compareNumbers = (a: string, b: string): number => {
  const x = a.replace(/^0+(?=\d)/, "");
  const y = b.replace(/^0+(?=\d)/, "");
  return x.length - y.length || compareStrings(x, y);
};

/**
 * Orders the files of a folder the way a file manager lists them: digit runs
 * by value (`2` before `10`), letters ignoring case and accents.
 */
export const compareFileNames = (a: string, b: string): number => {
  const left = chunks(a);
  const right = chunks(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i]!;
    const y = right[i]!;
    const order = isDigits(x) && isDigits(y) ? compareNumbers(x, y) : compareStrings(x, y);
    if (order !== 0) return order;
  }
  return left.length - right.length || compareStrings(a, b);
};
