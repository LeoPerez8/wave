/**
 * Library model: turns the raw tags the scanner read from a file into the
 * values Wave stores and displays, and defines how tracks, albums and artists
 * are identified and sorted.
 *
 * - Untagged files still appear: the title falls back to the file name and the
 *   artist and album to "Unknown Artist" / "Unknown Album".
 * - An album is identified by its title + album artist. The album artist is the
 *   tag when present, "Various Artists" for compilations, and otherwise the
 *   track artist.
 * - Sort keys ignore case, accents and a leading "The" / "A" / "An". Names that
 *   don't start with a letter (digits, symbols) sort after Z.
 */

export const UNKNOWN_ARTIST = "Unknown Artist";
export const UNKNOWN_ALBUM = "Unknown Album";
export const VARIOUS_ARTISTS = "Various Artists";

/** What the native scanner reports for one audio file. Tag values are raw strings as read from the file. */
export interface RawTrack {
  /** Absolute path, e.g. `/storage/emulated/0/Music/Album/01 Song.flac`. */
  readonly path: string;
  readonly title?: string | null | undefined;
  readonly artist?: string | null | undefined;
  /**
   * Every value of a multi-value artist tag (Vorbis comments, ID3v2.4), when
   * the reader has them: each is a credit of its own, where [artist] holds the first.
   */
  readonly artists?: readonly string[] | null | undefined;
  readonly album?: string | null | undefined;
  readonly albumArtist?: string | null | undefined;
  /** Every value of a multi-value album artist tag, as [artists]. */
  readonly albumArtists?: readonly string[] | null | undefined;
  readonly genre?: string | null | undefined;
  /**
   * Every value of a multi-value genre tag (Vorbis comments, ID3v2.4), when
   * the reader has them, where [genre] holds the first.
   */
  readonly genres?: readonly string[] | null | undefined;
  /** Year or date as tagged, e.g. `1997` or `1997-05-21`. */
  readonly year?: string | null | undefined;
  /** Track number as tagged, e.g. `3` or `3/12`. */
  readonly trackNumber?: string | null | undefined;
  /** Disc number as tagged, e.g. `1` or `1/2`. */
  readonly discNumber?: string | null | undefined;
  readonly compilation?: boolean | null | undefined;
  readonly durationMs?: number | null | undefined;
}

/** A track as Wave stores it: every display field filled in, plus sort and identity keys. */
export interface LibraryTrack {
  readonly path: string;
  /** The folder holding the file, without a trailing slash. */
  readonly folder: string;
  readonly fileName: string;

  readonly title: string;
  readonly titleSort: string;

  /** The artist credit as rows show it: [artistCredits] joined with commas. */
  readonly artist: string;
  readonly artistSort: string;
  readonly artistKey: string;
  /**
   * The artist credits: one per value of the artist tag (usually one). Each
   * names its own artists (Core's `creditSplitter`), so separate values never
   * make one artist.
   */
  readonly artistCredits: readonly string[];

  readonly album: string;
  readonly albumSort: string;
  /** Identity of the album: title + album artist. Tracks with the same key are one album. */
  readonly albumKey: string;

  /** The album artist credit as rows show it: [albumArtistCredits] joined with commas. */
  readonly albumArtist: string;
  readonly albumArtistSort: string;
  readonly albumArtistKey: string;
  /** The album artist credits, as [artistCredits]. */
  readonly albumArtistCredits: readonly string[];

  readonly genre: string | null;
  readonly genreSort: string | null;
  readonly genreKey: string | null;
  /**
   * Every value of the genre tag ([genre] is the first; none without one).
   * The Library files the song under [genre] alone; Genre mixes count each.
   */
  readonly genres: readonly string[];

  readonly year: number | null;
  readonly trackNumber: number | null;
  readonly trackTotal: number | null;
  readonly discNumber: number | null;
  readonly discTotal: number | null;
  readonly durationMs: number;
  readonly compilation: boolean;
}

const clean = (value: string | null | undefined): string | null => {
  if (value == null) return null;
  // Tags sometimes carry NUL terminators or padding; collapse runs of whitespace.
  const trimmed = value.replaceAll("\u0000", "").replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
};

const SPECIAL_LETTERS: Readonly<Record<string, string>> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ð: "d",
  ł: "l",
  þ: "th",
  ı: "i",
};

/** Lower-cases and strips accents (`Émilie` → `emilie`, `Straße` → `strasse`); collapses whitespace. */
export const foldAccentsAndCase = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[ßæœøđðłþı]/g, (letter) => SPECIAL_LETTERS[letter] ?? letter)
    .replace(/\s+/g, " ")
    .trim();

const LEADING_NON_ALPHANUMERIC = /^[^\p{L}\p{N}]+/u;
const LEADING_ARTICLE = /^(?:the|a|an) (?=\S)/;

/** Prefix that makes names starting with a digit or symbol sort after every letter. */
const NON_LETTER_PREFIX = "~";

/**
 * Sort key for a display name. Compare keys with plain code-unit order
 * (`<` in JS, `BINARY` collation in SQLite).
 *
 * `The Beatles` → `beatles`, `Émilie Simon` → `emilie simon`, `50 Cent` → `~50 cent`.
 */
export const sortKey = (name: string): string => {
  let key = foldAccentsAndCase(name);
  const withoutLeadingSymbols = key.replace(LEADING_NON_ALPHANUMERIC, "");
  if (withoutLeadingSymbols.length > 0) key = withoutLeadingSymbols;
  key = key.replace(LEADING_ARTICLE, "");
  return /^\p{L}/u.test(key) ? key : `${NON_LETTER_PREFIX}${key}`;
};

/**
 * Identity key for a name: case and whitespace don't make two artists or albums
 * different, but spelling (accents included) does.
 */
export const identityKey = (name: string): string =>
  name.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

/** Identity of an album: its title together with its album artist. */
export const albumKey = (album: string, albumArtist: string): string =>
  `${identityKey(album)}\u001f${identityKey(albumArtist)}`;

const parsePositive = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const match = /^\s*0*(\d{1,4})\s*$/.exec(value);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return n > 0 ? n : null;
};

/** Parses `3`, `03` or `3/12` into a number and an optional total. Zero and garbage are `null`. */
const parseNumberOfTotal = (
  value: string | null | undefined,
): { number: number | null; total: number | null } => {
  const text = clean(value);
  if (text === null) return { number: null, total: null };
  const [number, total] = text.split("/");
  return { number: parsePositive(number), total: parsePositive(total) };
};

/** Takes the year from `1997`, `1997-05-21` or `1997-05-21T00:00:00`. */
const parseYear = (value: string | null | undefined): number | null => {
  const text = clean(value);
  if (text === null) return null;
  const match = /^(\d{4})(?:$|\D)/.exec(text);
  if (!match?.[1]) return null;
  const year = Number(match[1]);
  return year >= 1000 ? year : null;
};

/** Drops ID3v1-style numeric references such as `(17)` in `(17)Rock`; a bare `(17)` is no genre. */
const parseGenre = (value: string | null | undefined): string | null =>
  clean(clean(value)?.replace(/^(?:\(\d+\))+/, "") ?? null);

const splitPath = (path: string): { folder: string; fileName: string } => {
  const slash = path.lastIndexOf("/");
  return slash < 0
    ? { folder: "", fileName: path }
    : { folder: path.slice(0, slash), fileName: path.slice(slash + 1) };
};

const stripExtension = (fileName: string): string => {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
};

/**
 * Resolves the album artist: the tag if present, "Various Artists" for a
 * compilation, otherwise the track artist.
 */
export const resolveAlbumArtist = (track: {
  readonly artist: string;
  readonly albumArtist?: string | null | undefined;
  readonly compilation?: boolean | null | undefined;
}): string => clean(track.albumArtist) ?? (track.compilation ? VARIOUS_ARTISTS : track.artist);

/** The credits a tag gives: one per value it has, else its single value; none when empty. */
const creditsOf = (
  value: string | null | undefined,
  values: readonly string[] | null | undefined,
): string[] => {
  const each = (values ?? []).flatMap((one) => clean(one) ?? []);
  if (each.length > 0) return each;
  const single = clean(value);
  return single === null ? [] : [single];
};

/** Several credits as rows show them: joined with commas ("Ariana Grande, Social House"). */
const shownCredit = (credits: readonly string[]): string | null =>
  credits.length > 0 ? credits.join(", ") : null;

/** Turns raw scanner output into a library track with fallbacks, parsed numbers and keys. */
export const normalizeTrack = (raw: RawTrack): LibraryTrack => {
  const { folder, fileName } = splitPath(raw.path);
  const title = clean(raw.title) ?? (clean(stripExtension(fileName)) || fileName);
  const tagged = creditsOf(raw.artist, raw.artists);
  const artistCredits = tagged.length > 0 ? tagged : [UNKNOWN_ARTIST];
  const artist = shownCredit(artistCredits) ?? UNKNOWN_ARTIST;
  const album = clean(raw.album) ?? UNKNOWN_ALBUM;
  const compilation = raw.compilation === true;
  const albumArtistTagged = creditsOf(raw.albumArtist, raw.albumArtists);
  const albumArtist = resolveAlbumArtist({
    artist,
    albumArtist: shownCredit(albumArtistTagged),
    compilation,
  });
  const albumArtistCredits =
    albumArtistTagged.length > 0
      ? albumArtistTagged
      : compilation
        ? [VARIOUS_ARTISTS]
        : artistCredits;
  const genre = parseGenre(raw.genre);
  const genreValues = (raw.genres ?? []).flatMap((value) => parseGenre(value) ?? []);
  const track = parseNumberOfTotal(raw.trackNumber);
  const disc = parseNumberOfTotal(raw.discNumber);
  const durationMs =
    typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) && raw.durationMs > 0
      ? Math.round(raw.durationMs)
      : 0;

  return {
    path: raw.path,
    folder,
    fileName,
    title,
    titleSort: sortKey(title),
    artist,
    artistSort: sortKey(artist),
    artistKey: identityKey(artist),
    artistCredits,
    album,
    albumSort: sortKey(album),
    albumKey: albumKey(album, albumArtist),
    albumArtist,
    albumArtistSort: sortKey(albumArtist),
    albumArtistKey: identityKey(albumArtist),
    albumArtistCredits,
    genre,
    genreSort: genre === null ? null : sortKey(genre),
    genreKey: genre === null ? null : identityKey(genre),
    genres: genreValues.length > 0 ? genreValues : genre === null ? [] : [genre],
    year: parseYear(raw.year),
    trackNumber: track.number,
    trackTotal: track.total,
    discNumber: disc.number,
    discTotal: disc.total,
    durationMs,
    compilation,
  };
};

/** Orders strings by code unit, the way SQLite's default collation does. */
export const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A track's file, or none (null) for a missing song, which the Wave account has and the phone lacks. */
interface TrackFile {
  readonly path: string | null;
}

/** Orders by file, the last tie-break: a missing song (no file) before the files. */
const compareFiles = (a: TrackFile, b: TrackFile): number =>
  compareStrings(a.path ?? "", b.path ?? "");

/** Orders tracks by title, the way the Songs list shows them. */
export const compareByTitle = (
  a: Pick<LibraryTrack, "titleSort" | "artistSort"> & TrackFile,
  b: Pick<LibraryTrack, "titleSort" | "artistSort"> & TrackFile,
): number =>
  compareStrings(a.titleSort, b.titleSort) ||
  compareStrings(a.artistSort, b.artistSort) ||
  compareFiles(a, b);

/**
 * Orders tracks within an album: by disc, then track number. A missing disc
 * counts as disc 1; tracks without a number go after the numbered ones of their
 * disc, by title.
 */
export const compareAlbumTracks = (
  a: Pick<LibraryTrack, "discNumber" | "trackNumber" | "titleSort"> & TrackFile,
  b: Pick<LibraryTrack, "discNumber" | "trackNumber" | "titleSort"> & TrackFile,
): number =>
  (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
  (a.trackNumber ?? Number.MAX_SAFE_INTEGER) - (b.trackNumber ?? Number.MAX_SAFE_INTEGER) ||
  compareStrings(a.titleSort, b.titleSort) ||
  compareFiles(a, b);
