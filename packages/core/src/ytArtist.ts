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
import { discoverSongs, type DiscoverSong, type YtShelfItem } from "./ytDiscover.ts";
import { libraryFinder, type LibrarySongKey, type YtSong } from "./ytMusic.ts";
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
  /** Their picture as the row shows it, when it has one (Search's rows show it). */
  readonly artworkUrl?: string | null;
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

/**
 * Finds the Library artist (among [artists]) a YouTube Music artist's name
 * is, or null: names compare as `pickYtArtist` compares them (as artist
 * photos do). Names that aren't an artist's ("Unknown Artist") are nobody's.
 * Build it once per Library and ask it for many names.
 */
export const libraryArtistFinder = <A extends { readonly name: string }>(
  artists: readonly A[],
): ((name: string) => A | null) => {
  const byName = new Map<string, A>();
  for (const artist of artists) {
    const name = artistPhotoName(artist.name);
    if (!byName.has(name)) byName.set(name, artist);
  }
  return (name) =>
    ytArtistQuery(name) === null ? null : (byName.get(artistPhotoName(name)) ?? null);
};

/** An album or single on a YouTube Music artist page, as a shelf tile shows it. */
export type YtArtistAlbum = Extract<YtShelfItem, { readonly kind: "album" }>;

/**
 * A YouTube Music artist page as far as Wave reads it: their top songs and
 * their albums and singles, in the page's order, and every song of theirs
 * once the Songs shelf's playlist is read after it.
 */
export interface YtArtistPage<S extends YtSong = YtSong> {
  /** The artist's name as YouTube Music writes it. */
  readonly name: string;
  /** Their image, when the page has one (pages saved before it was read have none). */
  readonly artworkUrl?: string | null;
  /** Their top songs. */
  readonly songs: readonly S[];
  /**
   * The playlist of every song of theirs, the Songs shelf's "See all"
   * (without `VL`), or null when the page has none. Pages saved before it
   * was read have none.
   */
  readonly songsPlaylistId?: string | null;
  /**
   * Every song of the artist, in YouTube Music's order: [songsPlaylistId]
   * read after the page (Core's `readYtPlaylist`), or the top songs when the
   * page has no such playlist or YouTube can't give it (`ytArtistFullPage`).
   * Undefined on the page as read, in answers saved before it was read and in
   * a Library album's (which reads the page only): those don't stand on an
   * artist's page.
   */
  readonly allSongs?: readonly S[];
  /**
   * Whether [allSongs] stops short of every song of the artist: the
   * playlist's read stopped at its cap, or it couldn't be read and the top
   * songs stand in (`ytArtistFullPage`). Undefined: the list is whole.
   */
  readonly allSongsCut?: boolean;
  readonly albums: readonly YtArtistAlbum[];
  readonly singles: readonly YtArtistAlbum[];
}

/** How reading an artist's songs playlist (`readYtPlaylist`) went. */
export type YtArtistSongsRead<S extends YtSong = YtSong> =
  /** Every page in, or as many as the cap allows ([truncated]). */
  | { readonly status: "read"; readonly songs: readonly S[]; readonly truncated: boolean }
  /** A page got no answer, after [pagesRead] pages had come. */
  | {
      readonly status: "failed";
      readonly reason: YtQuietReason | "disabled";
      readonly pagesRead: number;
    };

/** The artist's page with every song of theirs, or why the whole request fails. */
export type YtArtistFullPage<S extends YtSong = YtSong> =
  | { readonly status: "read"; readonly page: YtArtistPage<S> }
  | { readonly status: "failed"; readonly reason: YtQuietReason | "disabled" };

/**
 * The artist [page] as read, with every song of theirs (`allSongs`) from how
 * reading its songs playlist went ([read]; null when the page has none, and
 * then its top songs are the whole list). A list the read cut at its cap is
 * kept as cut short (`allSongsCut`). When YouTube can't give the playlist at
 * all (its first page failed, not offline), the top songs stand in, cut
 * short. Offline, YT Music turned off, or a later page failing after earlier
 * ones came, the whole request fails, so a half-read list never stands.
 */
export const ytArtistFullPage = <S extends YtSong>(
  page: YtArtistPage<S>,
  read: YtArtistSongsRead<S> | null,
): YtArtistFullPage<S> => {
  if (read === null) return { status: "read", page: { ...page, allSongs: page.songs } };
  if (read.status === "read") {
    const cut = read.truncated ? { allSongsCut: true } : {};
    return { status: "read", page: { ...page, allSongs: read.songs, ...cut } };
  }
  if (read.reason !== "failed" || read.pagesRead > 0)
    return { status: "failed", reason: read.reason };
  return { status: "read", page: { ...page, allSongs: page.songs, allSongsCut: true } };
};

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

/**
 * Whether [saved] stands on an artist's page, the Library's or YouTube
 * Music's, at [now]: fresh and, for a match, with the artist's full list
 * (`allSongs`). A match saved before the list was read counts as expired, so
 * the page asks again.
 */
const standsOnArtistPage = (saved: YtArtistSaved, now: number): boolean =>
  isFresh(saved, now) && (saved.outcome === "unmatched" || saved.page.allSongs !== undefined);

/**
 * What's saved for the artist once [answer] comes at [now], given what's
 * saved meanwhile ([current]): the answer, unless it was read without the
 * artist's full list (a Library album's ask reads their page only) while
 * [current] stands on the artist page with it. Then [current] stays, and
 * the album finds its release in it all the same.
 */
export const ytArtistAnswerKept = <S extends YtSong>(
  current: YtArtistSaved<S> | null,
  answer: YtArtistSaved<S>,
  now: number,
): YtArtistSaved<S> =>
  current !== null && standsOnArtistPage(current, now) && !standsOnArtistPage(answer, now)
    ? current
    : answer;

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

/**
 * Finds the Library album a YouTube Music release is, wherever it was found
 * (Search, say): for each artist the release credits that the Library has
 * ([artistNamed], Core's `libraryArtistFinder`), their album with the
 * release's title, as `libraryAlbumFinder` matches it. Null when none of
 * them has it.
 */
export const libraryReleaseFinder = <A extends LibraryAlbumKey>(
  artistNamed: (name: string) => { readonly id: number } | null,
  albums: readonly A[],
): ((release: { readonly title: string; readonly artists: readonly string[] }) => A | null) => {
  const finders = new Map<number, (release: { readonly title: string }) => A | null>();
  const finderOf = (artistId: number) => {
    let find = finders.get(artistId);
    if (find === undefined) {
      find = libraryAlbumFinder(artistId, albums);
      finders.set(artistId, find);
    }
    return find;
  };
  return (release) => {
    for (const name of release.artists) {
      const artist = artistNamed(name);
      const album = artist === null ? null : finderOf(artist.id)(release);
      if (album !== null) return album;
    }
    return null;
  };
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
  /** The Library already has every song of the artist. */
  | "allInLibrary"
  /** YouTube Music lists no songs for the artist. */
  | "noSongs"
  /** No YouTube Music artist matched. */
  | "notFound"
  | YtQuietReason;

export interface YtArtistSectionView<S extends YtSong> {
  /** Every song of the artist the Library doesn't have (`allSongs`), in YouTube Music's order. */
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
  /**
   * Whether the page was opened integrated (from a streamed song's artist):
   * with nothing standing it asks on its own (`ytArtistSectionAsks`) instead
   * of offering the button. Undefined: opened as the Library's.
   */
  readonly integrated?: boolean;
  /** Whether the Library already has a song (Core's `libraryMatcher`). */
  readonly inLibrary: (song: S) => boolean;
}

/**
 * What the section shows at the end of the artist page, or null when it's
 * hidden: YT Music off, a name that isn't an artist's, or what was saved not
 * read yet. A saved answer shows for a week without the button; after that,
 * with nothing saved, or with a match saved before the artist's full list
 * was read (no `allSongs`), the button is back, unless the page was opened
 * integrated: then it's looking (it asks on its own, `ytArtistSectionAsks`)
 * until an ask fails.
 */
export const ytArtistSectionView = <S extends YtSong>(
  state: YtArtistSection<S>,
  context: YtArtistSectionContext<S>,
): YtArtistSectionView<S> | null => {
  if (!context.enabled || ytArtistQuery(context.name) === null) return null;
  if (state.status === "reading") return null;
  if (state.status === "loading") return { songs: [], note: "loading", button: false };
  const { saved } = state;
  if (saved !== null && standsOnArtistPage(saved, context.now)) {
    if (saved.outcome === "unmatched") return { songs: [], note: "notFound", button: false };
    const all = saved.page.allSongs ?? [];
    const songs = all.filter((song) => !context.inLibrary(song));
    // A list cut short can't tell that the Library has every song, or that there are none.
    const quiet = songs.length > 0 || saved.page.allSongsCut === true;
    const note = quiet ? null : all.length === 0 ? "noSongs" : "allInLibrary";
    return { songs, note, button: false };
  }
  if (context.integrated === true && state.failure === null)
    return { songs: [], note: "loading", button: false };
  return { songs: [], note: state.failure, button: true };
};

export interface YtArtistSectionAsksContext {
  /** The Library artist's name. */
  readonly name: string;
  /** Whether YT Music is on in Settings. */
  readonly enabled: boolean;
  readonly now: number;
  /** Whether the page was opened integrated (from a streamed song's artist). */
  readonly integrated: boolean;
}

/**
 * Whether a Library artist page asks YouTube Music now, on its own: only
 * when it was opened integrated, once what was saved is read, with nothing
 * standing for the artist (`YT_ARTIST_FRESH_MS`, or a match saved without
 * the artist's full list) and YT Music on. After a
 * failure it waits for the button (`requested`).
 */
export const ytArtistSectionAsks = (
  state: YtArtistSection,
  context: YtArtistSectionAsksContext,
): boolean =>
  context.integrated &&
  context.enabled &&
  ytArtistQuery(context.name) !== null &&
  state.status === "ready" &&
  state.failure === null &&
  (state.saved === null || !standsOnArtistPage(state.saved, context.now));

/**
 * Whether the artist page is an integrated view: YT Music on and the
 * artist's answer, a match, standing (`ytArtistSectionView` shows it). A
 * Library album opened from it reads its release on its own
 * (`ytLibraryAlbumView`).
 */
export const ytArtistIntegrated = (
  state: YtArtistSection,
  context: { readonly name: string; readonly enabled: boolean; readonly now: number },
): boolean =>
  context.enabled &&
  ytArtistQuery(context.name) !== null &&
  state.status === "ready" &&
  state.saved?.outcome === "found" &&
  standsOnArtistPage(state.saved, context.now);

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
 * An artist [page]'s Albums, then Singles & EPs, each newest first, with the
 * Library album each release already is; a shelf with nothing on it is left out.
 */
const pageShelves = <A>(
  page: YtArtistPage,
  libraryAlbum: (album: YtArtistAlbum) => A | null,
): YtArtistShelf<A>[] => {
  const shelf = (kind: YtArtistShelf<A>["kind"], albums: readonly YtArtistAlbum[]) => ({
    kind,
    releases: newestFirst(albums).map((album) => ({ album, library: libraryAlbum(album) })),
  });
  return [shelf("albums", page.albums), shelf("singles", page.singles)].filter(
    ({ releases }) => releases.length > 0,
  );
};

/**
 * The shelves under the section's songs: Albums, then Singles & EPs, from
 * the saved artist page, each newest first. They show while the saved page
 * does (`ytArtistSectionView`); a shelf with nothing on it is left out.
 */
export const ytArtistShelves = <A>(
  state: YtArtistSection,
  context: YtArtistShelvesContext<A>,
): YtArtistShelf<A>[] => {
  if (!context.enabled || ytArtistQuery(context.name) === null) return [];
  if (state.status !== "ready" || state.saved?.outcome !== "found") return [];
  if (!standsOnArtistPage(state.saved, context.now)) return [];
  return pageShelves(state.saved.page, context.libraryAlbum);
};

/**
 * The release on the artist's YouTube Music [page] that the Library [album]
 * is, or null: the albums first, then the singles, matched as
 * `libraryAlbumFinder` matches them for the artist [artistId].
 */
export const ytArtistRelease = (
  page: YtArtistPage,
  artistId: number,
  album: LibraryAlbumKey,
): YtArtistAlbum | null => {
  const find = libraryAlbumFinder(artistId, [album]);
  return [...page.albums, ...page.singles].find((release) => find(release) !== null) ?? null;
};

/** A release's page being read for a Library album: its songs, in album order. */
export type YtReleaseLoad<S extends YtSong = YtSong> =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly songs: readonly S[] }
  | { readonly status: "quiet"; readonly reason: YtQuietReason };

/** A quiet line a Library album's page shows under its tracks while it looks on YouTube Music. */
export type YtLibraryAlbumNote =
  | "loading"
  /** No YouTube Music artist matched, or their page has no such release. */
  | "notFound"
  | YtQuietReason;

/** A Library song as an album's tracklist orders it. */
export interface LibraryAlbumTrack extends LibrarySongKey {
  readonly trackNumber: number | null;
}

/**
 * A row of a Library album's tracklist once its release is known: a Library
 * song (the album's own track, or the Library's file of it from another
 * album), or a song of the release streamed. [number] is its place on the
 * release, or the Library track's number.
 */
export type YtAlbumEntry<S extends YtSong, L> =
  | { readonly source: "library"; readonly track: L; readonly number: number | null }
  | { readonly source: "stream"; readonly song: S; readonly number: number };

/**
 * A Library album's [tracks] with its release's [songs], in the release's
 * order: each song is the album's own track when it has it, else the
 * Library's file of it ([elsewhere], Core's `libraryFinder`), else streamed.
 * The album's tracks the release doesn't list keep their place by their
 * number (after the release's song with that number), or go last.
 */
export const ytAlbumTracklist = <S extends YtSong, L extends LibraryAlbumTrack>(
  songs: readonly S[],
  tracks: readonly L[],
  elsewhere: (song: S) => L | null,
): YtAlbumEntry<S, L>[] => {
  const own = libraryFinder(tracks);
  const used = new Set<L>();
  const entries: YtAlbumEntry<S, L>[] = songs.map((song, index) => {
    const number = index + 1;
    const track = own(song) ?? elsewhere(song);
    if (track === null || used.has(track)) return { source: "stream", song, number };
    used.add(track);
    return { source: "library", track, number };
  });
  const place = (entry: YtAlbumEntry<S, L>): number => entry.number ?? Number.POSITIVE_INFINITY;
  const rest = tracks
    .filter((track) => !used.has(track))
    .map((track): YtAlbumEntry<S, L> => ({ source: "library", track, number: track.trackNumber }));
  for (const entry of rest) {
    const at = entries.findIndex((other) => place(other) > place(entry));
    entries.splice(at === -1 ? entries.length : at, 0, entry);
  }
  return entries;
};

export interface YtLibraryAlbumView<S extends YtSong, L> {
  /**
   * The album's tracklist with the release's songs the Library doesn't have
   * (`ytAlbumTracklist`), or null to show the album as it is: the release
   * not known or read yet, or nothing on it the Library lacks.
   */
  readonly tracks: readonly YtAlbumEntry<S, L>[] | null;
  /** The release's songs, once its page is read: what Download acts on. */
  readonly songs: readonly S[] | null;
  readonly note: YtLibraryAlbumNote | null;
  /**
   * Whether Show on YouTube Music is offered: it asks for the artist or, once
   * the release is known, reads the release's page again.
   */
  readonly button: boolean;
  /** The YouTube Music release the album is, once known; its page gives the songs. */
  readonly release: YtArtistAlbum | null;
  /**
   * Whether the album asks YouTube Music for its artist now, on its own: it's
   * integrated and nothing stands for the artist yet. Asked once; a failure
   * leaves the button.
   */
  readonly askArtist: boolean;
}

export interface YtLibraryAlbumContext<S extends YtSong, L> {
  /** The name of the album's (first) album artist in the Library. */
  readonly name: string;
  /** That artist's Library id. */
  readonly artistId: number;
  readonly album: LibraryAlbumKey;
  /** The album's tracks, in album order. */
  readonly tracks: readonly L[];
  /** The Library's file of a song the album's tracks don't have, or null (Core's `libraryFinder`). */
  readonly elsewhere: (song: S) => L | null;
  /** Whether YT Music is on in Settings. */
  readonly enabled: boolean;
  readonly now: number;
  /**
   * Whether the album is an integrated view: opened from one (an integrated
   * artist page, Search showing YouTube Music's results), or Show on YouTube
   * Music was tapped. Otherwise it shows the Library's tracks and the button.
   */
  readonly integrated: boolean;
  /**
   * Whether the page has shown the tracklist during this visit: it stays when
   * the last download finishes, every row in its place, instead of the album
   * showing as it is (that waits for the page to be opened again).
   */
  readonly keepTracklist?: boolean | undefined;
  /** How far [release]'s page has been read; undefined when it hasn't been asked for. */
  readonly releasePage: (release: YtArtistAlbum) => YtReleaseLoad<S> | undefined;
}

const albumNote = <S extends YtSong, L>(
  note: YtLibraryAlbumNote | null,
  button: boolean,
  release: YtArtistAlbum | null = null,
): YtLibraryAlbumView<S, L> => ({
  tracks: null,
  songs: null,
  note,
  button,
  release,
  askArtist: false,
});

/**
 * What a Library album's page shows from YouTube Music, or null when it shows
 * nothing: YT Music off, an album artist that isn't an artist's name, or
 * what was saved for the artist not read yet. Not integrated, it's the
 * button, whatever is saved. Integrated, it goes by the artist page's saved
 * answer (`stepYtArtistSection`): while that stands, the album is looked up
 * among the artist's releases and, when it's there, the release's page is
 * read and its songs join the album's tracks. With nothing saved, or once
 * it's a week old, it asks for the artist on its own (`askArtist`); a failed
 * ask is a quiet line with the button.
 */
export const ytLibraryAlbumView = <S extends YtSong, L extends LibraryAlbumTrack>(
  state: YtArtistSection<S>,
  context: YtLibraryAlbumContext<S, L>,
): YtLibraryAlbumView<S, L> | null => {
  if (!context.enabled || ytArtistQuery(context.name) === null) return null;
  if (state.status === "reading") return null;
  if (!context.integrated) return albumNote(null, true);
  if (state.status === "loading") return albumNote("loading", false);
  const { saved } = state;
  if (saved === null || !isFresh(saved, context.now))
    return state.failure === null
      ? { ...albumNote<S, L>("loading", false), askArtist: true }
      : albumNote(state.failure, true);
  if (saved.outcome === "unmatched") return albumNote("notFound", false);
  const release = ytArtistRelease(saved.page, context.artistId, context.album);
  if (release === null) return albumNote("notFound", false);
  const page = context.releasePage(release);
  if (page === undefined || page.status === "loading") return albumNote("loading", false, release);
  if (page.status === "quiet") return albumNote(page.reason, true, release);
  const tracks = ytAlbumTracklist(page.songs, context.tracks, context.elsewhere);
  const streams = tracks.some((entry) => entry.source === "stream");
  return {
    tracks: streams || context.keepTracklist === true ? tracks : null,
    songs: page.songs,
    note: null,
    button: false,
    release,
    askArtist: false,
  };
};

export interface YtArtistPageContext {
  /** Whether YT Music is on in Settings. */
  readonly enabled: boolean;
  readonly now: number;
}

/**
 * Whether a YouTube Music artist page (an artist opened by their browse id)
 * asks YouTube Music now, on its own: the user asked for the artist by
 * opening the page. It asks once what was saved is read, when nothing saved
 * stands (`YT_ARTIST_FRESH_MS`, or a match saved without the artist's full
 * list) and YT Music is on; after a failure it waits for Try Again
 * (`requested`).
 */
export const ytArtistPageAsks = (state: YtArtistSection, context: YtArtistPageContext): boolean =>
  context.enabled &&
  state.status === "ready" &&
  state.failure === null &&
  (state.saved === null || !standsOnArtistPage(state.saved, context.now));

/** A quiet line a YouTube Music artist page shows in place of what it can't show. */
export type YtArtistPageNote =
  | "loading"
  /** YT Music is off in Settings: the page says so instead of asking. */
  | "off"
  /** Opened by name, no YouTube Music artist matched it. */
  | "notFound"
  | YtQuietReason;

export interface YtArtistPageView<S extends YtSong, L, A> {
  /** The artist's name and image from their page, once it's been read (and saved). */
  readonly name: string | null;
  readonly artworkUrl: string | null;
  /**
   * Every song of theirs (`allSongs`) in YouTube Music's order: the Library's
   * play its files, the rest stream.
   */
  readonly songs: readonly DiscoverSong<S, L>[];
  /** Their Albums, then Singles & EPs, newest first, each with the Library's album for it. */
  readonly shelves: readonly YtArtistShelf<A>[];
  readonly note: YtArtistPageNote | null;
  /** Whether Try Again is offered. */
  readonly retry: boolean;
}

export interface YtArtistPageViewContext<S extends YtSong, L, A> extends YtArtistPageContext {
  /** The Library's song a song of the artist already is, or null (Core's `libraryFinder`). */
  readonly librarySong: (song: S) => L | null;
  /** The Library's album a release already is, or null (Core's `libraryAlbumFinder`). */
  readonly libraryAlbum: (album: YtArtistAlbum) => A | null;
}

/**
 * What a YouTube Music artist page shows: the artist page's integrated view
 * with nothing from the Library but the songs and releases it already has.
 * A saved answer shows for a week (`YT_ARTIST_FRESH_MS`), "no match" (a page
 * opened by name) as a quiet Not found line; a match saved without the
 * artist's full list doesn't stand. Without one the page is looking
 * (it asks on its own, `ytArtistPageAsks`) or, after a failure, a quiet line
 * with Try Again. With YT Music off it says so.
 */
export const ytArtistPageView = <S extends YtSong, L, A>(
  state: YtArtistSection<S>,
  context: YtArtistPageViewContext<S, L, A>,
): YtArtistPageView<S, L, A> => {
  const saved = state.status === "reading" ? null : state.saved;
  const page = saved?.outcome === "found" ? saved.page : null;
  const head = { name: page?.name ?? null, artworkUrl: page?.artworkUrl ?? null };
  const quiet = (note: YtArtistPageNote | null, retry = false): YtArtistPageView<S, L, A> => ({
    ...head,
    songs: [],
    shelves: [],
    note,
    retry,
  });
  if (!context.enabled) return quiet("off");
  if (state.status === "reading") return quiet(null);
  if (state.status === "loading") return quiet("loading");
  if (saved !== null && standsOnArtistPage(saved, context.now)) {
    if (saved.outcome === "unmatched") return quiet("notFound");
    return {
      ...head,
      songs: discoverSongs(saved.page.allSongs ?? [], context.librarySong),
      shelves: pageShelves(saved.page, context.libraryAlbum),
      note: null,
      retry: false,
    };
  }
  // Nothing standing: it asks on its own (`ytArtistPageAsks`) unless the last ask failed.
  return state.failure === null ? quiet("loading") : quiet(state.failure, true);
};
