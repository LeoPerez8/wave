/**
 * The YT Music section of an artist page (docs/spec.md, "YT Music"): support
 * for the Library, asked for only when Show on YouTube Music is tapped. Core
 * decides who gets the button, which YouTube Music artist the Library's artist
 * is, what tapping asks, how long a saved answer stands, what the section
 * shows and which of the artist's releases the Library already has. The
 * native module asks and reads; the app saves and lays out.
 */

import { artistPhotoName, artistPhotoQuery } from "./artistPhoto.ts";
import { normalizeSearchText } from "./search.ts";
import type { YtShelfItem } from "./ytDiscover.ts";
import type { YtSong } from "./ytMusic.ts";
import type { YtQuietReason } from "./ytSearch.ts";

/**
 * The name to search YouTube Music for, or null when the name isn't an
 * artist's ("Various Artists", "Unknown Artist", no letters): those get no
 * button. Names are read as artist photos read them.
 */
export const ytArtistQuery = (name: string): string | null => artistPhotoQuery(name);

/** An artist YouTube Music's Artists search found. */
export interface YtArtistCandidate {
  readonly name: string;
  /** Their page (`UC…`). */
  readonly browseId: string;
  /** How followed they are (subscribers or monthly audience, as the row says), when it says. */
  readonly audience: number | null;
}

/**
 * The browse id of the YouTube Music artist [name] is, or null without a
 * match: only a name that matches exactly (as artist photos compare names,
 * `artistPhotoName`) counts and, among namesakes, the most followed one is
 * the artist.
 */
export const pickYtArtist = (
  name: string,
  candidates: readonly YtArtistCandidate[],
): string | null => {
  if (ytArtistQuery(name) === null) return null;
  const wanted = artistPhotoName(name);
  let best: YtArtistCandidate | undefined;
  for (const candidate of candidates) {
    if (artistPhotoName(candidate.name) !== wanted) continue;
    if (best === undefined || (candidate.audience ?? -1) > (best.audience ?? -1)) best = candidate;
  }
  return best?.browseId ?? null;
};

/** An album or single on a YouTube Music artist page, as a shelf tile shows it. */
export type YtArtistAlbum = Extract<YtShelfItem, { readonly kind: "album" }>;

/**
 * A YouTube Music artist page as far as Wave reads it: their top songs and
 * their albums and singles, in the page's order.
 */
export interface YtArtistPage<S extends YtSong = YtSong> {
  /** The artist's name as YouTube Music writes it. */
  readonly name: string;
  readonly songs: readonly S[];
  readonly albums: readonly YtArtistAlbum[];
  readonly singles: readonly YtArtistAlbum[];
}

/**
 * What was saved for a Library artist the last time YouTube Music answered:
 * their page with the artist's browse id, or that no artist matched.
 */
export type YtArtistSaved<S extends YtSong = YtSong> =
  | {
      readonly outcome: "found";
      /** When it was fetched (ms since the epoch). */
      readonly checkedAt: number;
      readonly browseId: string;
      readonly page: YtArtistPage<S>;
    }
  | { readonly outcome: "unmatched"; readonly checkedAt: number };

/** What tapping Show on YouTube Music asks: an Artists search, or the matched artist's page. */
export type YtArtistLookup =
  | { readonly kind: "search"; readonly query: string }
  | { readonly kind: "page"; readonly browseId: string };

/**
 * What to ask YouTube Music for [name], given what was [saved]: a saved match
 * skips the search; nothing saved, or a saved "no match", searches by name.
 * Null when the name isn't an artist's.
 */
export const ytArtistLookup = (
  name: string,
  saved: YtArtistSaved | null,
): YtArtistLookup | null => {
  const query = ytArtistQuery(name);
  if (query === null) return null;
  return saved?.outcome === "found"
    ? { kind: "page", browseId: saved.browseId }
    : { kind: "search", query };
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a saved answer (the page, or "no match") is shown without asking again. */
export const YT_ARTIST_FRESH_MS = 7 * DAY_MS;

/** Whether [saved] still stands at [now]: fetched less than a week ago. */
const isFresh = (saved: YtArtistSaved, now: number): boolean =>
  now - saved.checkedAt < YT_ARTIST_FRESH_MS;

/** A Library album as matching a release to it sees it. */
export interface LibraryAlbumKey {
  readonly title: string;
  /** Every artist its album artist credit names (the Library's artist identity). */
  readonly albumArtistIds: readonly number[];
}

/** Words that make a note about the release's edition ("Deluxe", "Remastered 2011", "- Single"). */
const EDITION =
  /\b(?:remaster(?:ed)?|deluxe|edition|expanded|version|anniversary|bonus|special|explicit|clean|extended|reissue|single|ep)\b/iu;
/** Words that make a note another release: a live, remixed or acoustic one. */
const ANOTHER_RELEASE =
  /\b(?:live|remix(?:es)?|mix(?:es)?|acoustic|demo|instrumental|karaoke|covers?|sessions?|unplugged)\b/iu;
const BRACKETED_NOTE = /\s*(?:\([^)]*\)|\[[^\]]*\])/gu;
const DASHED_NOTE = /\s+[-–—]\s+([^-–—]*)$/u;

/** A bracketed featured credit: "(feat. X)", "[with X & Y]". */
const FEATURED = /^\s*[([]\s*(?:feat\b|ft\b|featuring\b|with\b)/iu;

const isVersionNote = (note: string): boolean =>
  FEATURED.test(note) || (EDITION.test(note) && !ANOTHER_RELEASE.test(note));

/**
 * A title as release matching compares it: without its version notes, then
 * case, accents and punctuation folded. A title that is only notes stays.
 */
const releaseTitle = (title: string): string => {
  const bare = title
    .replace(BRACKETED_NOTE, (note) => (isVersionNote(note) ? "" : note))
    .replace(DASHED_NOTE, (whole, note: string) => (isVersionNote(note) ? "" : whole))
    .trim();
  return normalizeSearchText(bare === "" ? title : bare);
};

/**
 * The Library album a YouTube Music release of the artist [artistId] already
 * is, or null: an album whose album artist credit names the artist (so a
 * collaboration is each credited artist's), with the release's title. Case,
 * accents, punctuation and version notes don't count: "(Deluxe Edition)",
 * "[Remastered 2011]", "- Single", "(feat. X)". A live or remix album is
 * another release.
 */
export const libraryAlbumFinder = <A extends LibraryAlbumKey>(
  artistId: number,
  albums: readonly A[],
): ((release: { readonly title: string }) => A | null) => {
  const byTitle = new Map<string, A>();
  for (const album of albums) {
    if (!album.albumArtistIds.includes(artistId)) continue;
    const title = releaseTitle(album.title);
    if (title !== "" && !byTitle.has(title)) byTitle.set(title, album);
  }
  return (release) => byTitle.get(releaseTitle(release.title)) ?? null;
};

/** The section's state; [S] is the song as the caller has it (the native result, say). */
export type YtArtistSection<S extends YtSong = YtSong> =
  /** What was saved for the artist is still being read. */
  | { readonly status: "reading" }
  | {
      readonly status: "ready";
      readonly saved: YtArtistSaved<S> | null;
      /** Why the last tap got no answer, until the next one. */
      readonly failure: YtQuietReason | null;
    }
  | { readonly status: "loading"; readonly saved: YtArtistSaved<S> | null };

export const YT_ARTIST_SECTION_START: { readonly status: "reading" } = { status: "reading" };

export type YtArtistSectionEvent<S extends YtSong = YtSong> =
  /** What the database has for the artist (null: nothing). */
  | { readonly type: "restored"; readonly saved: YtArtistSaved<S> | null }
  /** Show on YouTube Music was tapped. */
  | { readonly type: "requested" }
  /** YouTube Music answered, and the answer was saved. */
  | { readonly type: "answered"; readonly saved: YtArtistSaved<S> }
  /** No answer: offline, YouTube failing, or YT Music turned off meanwhile. Nothing is saved. */
  | { readonly type: "failed"; readonly reason: YtQuietReason | "disabled" };

export const stepYtArtistSection = <S extends YtSong>(
  state: YtArtistSection<S>,
  event: YtArtistSectionEvent<S>,
): YtArtistSection<S> => {
  switch (event.type) {
    case "restored":
      return state.status === "reading"
        ? { status: "ready", saved: event.saved, failure: null }
        : state;
    case "requested":
      return state.status === "ready" ? { status: "loading", saved: state.saved } : state;
    case "answered":
      return state.status === "loading"
        ? { status: "ready", saved: event.saved, failure: null }
        : state;
    case "failed":
      if (state.status !== "loading") return state;
      return {
        status: "ready",
        saved: state.saved,
        failure: event.reason === "disabled" ? null : event.reason,
      };
  }
};

/** A quiet line the section shows instead of (or until) songs. */
export type YtArtistSectionNote =
  | "loading"
  /** The Library already has every top song. */
  | "allInLibrary"
  /** The artist's page lists no top songs. */
  | "noSongs"
  /** No YouTube Music artist matched. */
  | "notFound"
  | YtQuietReason;

export interface YtArtistSectionView<S extends YtSong> {
  /** The artist's top songs the Library doesn't have, in YouTube Music's order. */
  readonly songs: readonly S[];
  readonly note: YtArtistSectionNote | null;
  /** Whether Show on YouTube Music is offered. */
  readonly button: boolean;
}

export interface YtArtistSectionContext<S extends YtSong> {
  /** The Library artist's name. */
  readonly name: string;
  /** Whether YT Music is on in Settings. */
  readonly enabled: boolean;
  readonly now: number;
  /** Whether the Library already has a song (Core's `libraryMatcher`). */
  readonly inLibrary: (song: S) => boolean;
}

/**
 * What the section shows at the end of the artist page, or null when it's
 * hidden: YT Music off, a name that isn't an artist's, or what was saved not
 * read yet. A saved answer shows for a week without the button; after that,
 * or with nothing saved, the button is back.
 */
export const ytArtistSectionView = <S extends YtSong>(
  state: YtArtistSection<S>,
  context: YtArtistSectionContext<S>,
): YtArtistSectionView<S> | null => {
  if (!context.enabled || ytArtistQuery(context.name) === null) return null;
  if (state.status === "reading") return null;
  if (state.status === "loading") return { songs: [], note: "loading", button: false };
  const { saved } = state;
  if (saved !== null && isFresh(saved, context.now)) {
    if (saved.outcome === "unmatched") return { songs: [], note: "notFound", button: false };
    const songs = saved.page.songs.filter((song) => !context.inLibrary(song));
    const note =
      songs.length > 0 ? null : saved.page.songs.length === 0 ? "noSongs" : "allInLibrary";
    return { songs, note, button: false };
  }
  return { songs: [], note: state.failure, button: true };
};

/** A release on one of the section's shelves, with the Library album it already is. */
export interface YtArtistRelease<A> {
  readonly album: YtArtistAlbum;
  /** The Library's album for it (Core's `libraryAlbumFinder`): In your Library, opening it. */
  readonly library: A | null;
}

/** One of the section's shelves of covers: the artist's albums, or their singles and EPs. */
export interface YtArtistShelf<A> {
  readonly kind: "albums" | "singles";
  readonly releases: readonly YtArtistRelease<A>[];
}

export interface YtArtistShelvesContext<A> {
  /** The Library artist's name. */
  readonly name: string;
  /** Whether YT Music is on in Settings. */
  readonly enabled: boolean;
  readonly now: number;
  /** The Library album a release already is, or null (Core's `libraryAlbumFinder`). */
  readonly libraryAlbum: (album: YtArtistAlbum) => A | null;
}

/** Newest first; a release without a year goes last, and ties keep the page's order. */
const newestFirst = (albums: readonly YtArtistAlbum[]): YtArtistAlbum[] =>
  albums
    .map((album, index) => ({ album, index }))
    .sort(
      (a, b) =>
        (b.album.year ?? Number.NEGATIVE_INFINITY) - (a.album.year ?? Number.NEGATIVE_INFINITY) ||
        a.index - b.index,
    )
    .map(({ album }) => album);

/**
 * The shelves under the section's top songs: Albums, then Singles & EPs, from
 * the saved artist page, each newest first. They show while the saved page
 * does (`ytArtistSectionView`); a shelf with nothing on it is left out.
 */
export const ytArtistShelves = <A>(
  state: YtArtistSection,
  context: YtArtistShelvesContext<A>,
): YtArtistShelf<A>[] => {
  if (!context.enabled || ytArtistQuery(context.name) === null) return [];
  if (state.status !== "ready" || state.saved?.outcome !== "found") return [];
  if (!isFresh(state.saved, context.now)) return [];
  const { page } = state.saved;
  const shelf = (kind: YtArtistShelf<A>["kind"], albums: readonly YtArtistAlbum[]) => ({
    kind,
    releases: newestFirst(albums).map((album) => ({ album, library: context.libraryAlbum(album) })),
  });
  return [shelf("albums", page.albums), shelf("singles", page.singles)].filter(
    ({ releases }) => releases.length > 0,
  );
};
