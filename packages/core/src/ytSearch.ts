/**
 * What Search has asked YouTube Music: the songs, artists and albums it found
 * for what's typed, which join the Library's results (the integrated view).
 * The Library | Online toggle at the end of the search field's row picks it.
 * Typing alone asks only when the Library has nothing for the query (and
 * Library wasn't picked); once Online is picked the view follows the query
 * until the field is cleared. Library hides YouTube Music's results with no
 * new request, and Online shows them again without asking when the query is
 * the one they answer. It loads in the background, shows a skeleton in place
 * of the last query's results while the next one loads, drops answers to
 * queries that are no longer typed, and turns a failure into a quiet line.
 * Off in Settings, it stays
 * hidden, with no toggle, and nothing is requested.
 */

import type { YtPick } from "./onlineToggle.ts";
import { createSearchIndex, type SearchEntry } from "./search.ts";
import {
  ytArtistMergedCounts,
  ytArtistQuery,
  type YtArtistAlbum,
  type YtArtistCandidate,
  type YtArtistSaved,
} from "./ytArtist.ts";
import type { YtSong } from "./ytMusic.ts";

/** Why the section shows a quiet line instead of results. */
export type YtQuietReason = "offline" | "failed";

/**
 * Who asked YT Music: the user, by picking Online, or Search on its own
 * because the Library has nothing for the query.
 */
export type YtAskedBy = "user" | "auto";

/** What YT Music found for a query: its songs, artists and albums, each in its order. */
export interface YtSearchAnswer<S extends YtSong = YtSong> {
  readonly songs: readonly S[];
  readonly artists: readonly YtArtistCandidate[];
  readonly albums: readonly YtArtistAlbum[];
}

const NO_ANSWER: YtSearchAnswer<never> = { songs: [], artists: [], albums: [] };

/** YT Music's answer to [query], kept while Library shows, for Online to show again. */
export type YtKeptAnswer<S extends YtSong = YtSong> = {
  readonly query: string;
} & YtSearchAnswer<S>;

/** The section's state; [S] is the song as the caller has it (the native result, say). */
export type YtSection<S extends YtSong = YtSong> =
  /** YT Music is off: no toggle, nothing asked. */
  | { readonly status: "hidden" }
  /**
   * Too little is typed to ask about: nothing shows. [pick] is the toggle's
   * segment picked since the field was last cleared (null: none).
   */
  | { readonly status: "idle"; readonly pick: YtPick | null }
  /**
   * The Library's results for [query] show alone, nothing asked: the Library
   * has results for it, or Library was [picked]. [kept] is the last answer
   * Online showed.
   */
  | {
      readonly status: "offered";
      readonly query: string;
      readonly picked: boolean;
      readonly kept: YtKeptAnswer<S> | null;
    }
  /**
   * YT Music is asked for [query] [delayMs] from now: at once when tapped,
   * once typing pauses. A skeleton stands where its results will go; the
   * last query's are gone.
   */
  | {
      readonly status: "loading";
      readonly query: string;
      readonly by: YtAskedBy;
      readonly delayMs: number;
    }
  | ({
      readonly status: "results";
      readonly query: string;
      readonly by: YtAskedBy;
    } & YtSearchAnswer<S>)
  | {
      readonly status: "quiet";
      readonly query: string;
      readonly reason: YtQuietReason;
      readonly by: YtAskedBy;
    };

export type YtSectionEvent<S extends YtSong = YtSong> =
  /**
   * What's in the search field now, whether YT Music is on in Settings and
   * whether the Library has results for it.
   */
  | {
      readonly type: "typed";
      readonly query: string;
      readonly enabled: boolean;
      readonly libraryHasResults: boolean;
      /**
       * Whether Search online is set to Always (`SearchOnline`): with nothing
       * picked since the field was last cleared, Online is, and every query
       * is asked once typing pauses. Undefined: Only on demand.
       */
      readonly always?: boolean;
    }
  /** A segment of the Library | Online toggle was tapped. */
  | { readonly type: "picked"; readonly pick: YtPick }
  | ({ readonly type: "found"; readonly query: string } & YtSearchAnswer<S>)
  | { readonly type: "failed"; readonly query: string; readonly reason: YtQuietReason };

export const YT_SECTION_HIDDEN: { readonly status: "hidden" } = { status: "hidden" };

/** How long typing has to pause before YT Music is asked. */
export const YT_SEARCH_DEBOUNCE_MS = 300;

/** The fewest characters worth asking YT Music about. */
const MIN_QUERY_LENGTH = 2;

/** The query to send for what's typed, or null when there's too little to search for. */
export const ytSearchQuery = (text: string): string | null => {
  const query = text.replace(/\s+/g, " ").trim();
  return query.length < MIN_QUERY_LENGTH ? null : query;
};

/** A line the section shows instead of results: an outcome (while loading, a skeleton shows). */
export type YtSectionNote = "noMatches" | "allInLibrary" | YtQuietReason;

/** What the Library already has of YT Music's results, so Search doesn't repeat it. */
export interface YtSearchLibrary<S extends YtSong> {
  /** Core's `libraryFinder`/`libraryMatcher`. */
  readonly hasSong: (song: S) => boolean;
  /** Core's `libraryArtistFinder`. */
  readonly hasArtist: (artist: YtArtistCandidate) => boolean;
  /** Core's `libraryReleaseFinder`. */
  readonly hasAlbum: (album: YtArtistAlbum) => boolean;
}

/** YT Music's best result: an artist, an album or a song it found that the Library lacks. */
export type YtSearchTop<S extends YtSong> =
  | { readonly kind: "artist"; readonly artist: YtArtistCandidate }
  | { readonly kind: "album"; readonly album: YtArtistAlbum }
  | { readonly kind: "song"; readonly song: S };

export interface YtSectionView<S extends YtSong> extends YtSearchAnswer<S> {
  /**
   * YT Music's best match, from what's shown: the top result when the Library
   * has nothing for the query. Null while the query loads.
   */
  readonly top: YtSearchTop<S> | null;
  readonly note: YtSectionNote | null;
  /**
   * The query is being asked: skeleton rows stand where YT Music's results
   * will go (after the Library's), with nothing of the last query's shown.
   */
  readonly loading: boolean;
  /**
   * Search shows YouTube Music's results (an integrated view): a Library
   * album opened from it opens integrated.
   */
  readonly integrated: boolean;
}

/**
 * YT Music's best of [shown] for [query]: the result that matches it best as
 * Search ranks the Library's (artists, then albums, then songs among equals);
 * with nothing matching word for word, its first song, else album, else artist.
 */
const ytTop = <S extends YtSong>(
  query: string,
  shown: YtSearchAnswer<S>,
): YtSearchTop<S> | null => {
  type Entry = SearchEntry & { readonly top: YtSearchTop<S> };
  const entries: Entry[] = [
    ...shown.artists.map((artist): Entry => ({
      kind: "artist",
      name: artist.name,
      top: { kind: "artist", artist },
    })),
    ...shown.albums.map((album): Entry => ({
      kind: "album",
      name: album.title,
      also: album.artists,
      top: { kind: "album", album },
    })),
    ...shown.songs.map((song): Entry => ({
      kind: "song",
      name: song.title,
      also: song.album === null ? song.artists : [...song.artists, song.album],
      top: { kind: "song", song },
    })),
  ];
  const best = createSearchIndex(entries).search(query).top;
  if (best !== null) return best.top;
  const [song] = shown.songs;
  if (song !== undefined) return { kind: "song", song };
  const [album] = shown.albums;
  if (album !== undefined) return { kind: "album", album };
  const [artist] = shown.artists;
  return artist === undefined ? null : { kind: "artist", artist };
};

const QUIET = { ...NO_ANSWER, top: null };

/**
 * The segment the Library | Online toggle shows selected, or null with YT
 * Music off (no toggle): Online while YouTube Music is asked or shows, by the
 * user or on its own.
 */
export const ytSectionToggle = (section: YtSection<YtSong>): YtPick | null => {
  switch (section.status) {
    case "hidden":
      return null;
    case "idle":
      return section.pick ?? "library";
    case "offered":
      return "library";
    default:
      return "online";
  }
};

/**
 * What the section shows, or null when it's hidden or too little is typed:
 * YT Music's songs, artists and albums, each in its order, minus those the
 * Library already has, which already show as the Library's. While Library is
 * the toggle's segment, nothing.
 */
export const ytSectionView = <S extends YtSong>(
  section: YtSection<S>,
  library: YtSearchLibrary<S>,
): YtSectionView<S> | null => {
  switch (section.status) {
    case "hidden":
    case "idle":
      return null;
    case "offered":
      return { ...QUIET, note: null, loading: false, integrated: false };
    case "quiet":
      return { ...QUIET, note: section.reason, loading: false, integrated: false };
    case "loading":
      return { ...QUIET, note: null, loading: true, integrated: true };
    case "results": {
      const shown: YtSearchAnswer<S> = {
        songs: section.songs.filter((song) => !library.hasSong(song)),
        artists: section.artists.filter((artist) => !library.hasArtist(artist)),
        albums: section.albums.filter((album) => !library.hasAlbum(album)),
      };
      const top = ytTop(section.query, shown);
      const note = !isEmpty(shown) ? null : isEmpty(section) ? "noMatches" : "allInLibrary";
      return { ...shown, top, note, loading: false, integrated: true };
    }
  }
};

const isEmpty = (answer: YtSearchAnswer<YtSong>): boolean =>
  answer.songs.length === 0 && answer.artists.length === 0 && answer.albums.length === 0;

/** Who asked YT Music, or null when it isn't asked (hidden, idle, or the Library's alone). */
const askedBy = <S extends YtSong>(state: YtSection<S>): YtAskedBy | null =>
  state.status === "hidden" || state.status === "idle" || state.status === "offered"
    ? null
    : state.by;

/** The segment the user picked since the field was last cleared, or null. */
const pickOf = <S extends YtSong>(state: YtSection<S>): YtPick | null => {
  switch (state.status) {
    case "hidden":
      return null;
    case "idle":
      return state.pick;
    case "offered":
      return state.picked ? "library" : null;
    default:
      return state.by === "user" ? "online" : null;
  }
};

/** The answer Online last showed, kept for showing again. */
const keptOf = <S extends YtSong>(state: YtSection<S>): YtKeptAnswer<S> | null => {
  if (state.status === "offered") return state.kept;
  if (state.status !== "results") return null;
  const { query, songs, artists, albums } = state;
  return { query, songs, artists, albums };
};

/** The Library's results for [query] alone; [picked] when Library is the user's pick. */
const offered = <S extends YtSong>(
  state: YtSection<S>,
  query: string,
  picked: boolean,
): YtSection<S> => {
  const kept = keptOf(state);
  if (
    state.status === "offered" &&
    state.query === query &&
    state.picked === picked &&
    state.kept === kept
  )
    return state;
  return { status: "offered", query, picked, kept };
};

/** Asks YT Music for [query] at once, as the user did by picking Online. */
const askedNow = <S extends YtSong>(query: string): YtSection<S> => ({
  status: "loading",
  query,
  by: "user",
  delayMs: 0,
});

/** What tapping a segment of the toggle does. */
const picked = <S extends YtSong>(state: YtSection<S>, pick: YtPick): YtSection<S> => {
  switch (state.status) {
    case "hidden":
      return state;
    case "idle":
      return state.pick === pick ? state : { status: "idle", pick };
    case "offered": {
      if (pick === "library") return offered(state, state.query, true);
      const { kept } = state;
      // Online again for the query its answer is kept for: shown again, not asked again.
      if (kept !== null && kept.query === state.query)
        return { status: "results", ...kept, by: "user" };
      return askedNow(state.query);
    }
    case "quiet":
      // Online on a failure asks again.
      return pick === "library" ? offered(state, state.query, true) : askedNow(state.query);
    case "loading":
    case "results":
      if (pick === "library") return offered(state, state.query, true);
      return state.by === "user" ? state : { ...state, by: "user" };
  }
};

export const stepYtSection = <S extends YtSong>(
  state: YtSection<S>,
  event: YtSectionEvent<S>,
): YtSection<S> => {
  switch (event.type) {
    case "typed": {
      if (!event.enabled) return YT_SECTION_HIDDEN;
      // Clearing the field puts the toggle back (on Online under Always); a pick holds until then.
      const pick =
        (event.query.trim() === "" ? null : pickOf(state)) ??
        (event.always === true ? "online" : null);
      const query = ytSearchQuery(event.query);
      if (query === null)
        return state.status === "idle" && state.pick === pick ? state : { status: "idle", pick };
      if (pick === "library") return offered(state, query, true);
      // Picked Online, it follows the query; on its own, only while the Library has nothing.
      const by = pick === "online" ? "user" : event.libraryHasResults ? null : "auto";
      if (by === null) return offered(state, query, false);
      if (askedBy(state) === by && "query" in state && state.query === query) return state;
      return { status: "loading", query, by, delayMs: YT_SEARCH_DEBOUNCE_MS };
    }
    case "picked":
      return picked(state, event.pick);
    case "found":
      if (state.status !== "loading" || state.query !== event.query) return state;
      return {
        status: "results",
        query: event.query,
        songs: event.songs,
        artists: event.artists,
        albums: event.albums,
        by: state.by,
      };
    case "failed":
      if (state.status !== "loading" || state.query !== event.query) return state;
      return { status: "quiet", query: event.query, reason: event.reason, by: state.by };
  }
};

/**
 * Whether Search reads the online page of the Library artist [name] that is
 * its top hit (null: the top hit isn't a Library artist), for that row's song
 * count: once YouTube Music's answer to the query shows, so a query still
 * being typed reads nothing. Not for names that aren't an artist's.
 */
export const ytSearchArtistReads = (section: YtSection<YtSong>, name: string | null): boolean =>
  section.status === "results" && name !== null && ytArtistQuery(name) !== null;

/** Search counts songs only: releases don't count. */
const libraryRelease = (): boolean => true;

/**
 * The song count Search's row for its top-hit Library artist reads: with
 * Online selected and the artist's online answer [saved] standing (as their
 * page counts it, `ytArtistMergedCounts`), the Library's [local] count plus
 * every song of theirs it lacks, each once; otherwise (Library selected, no
 * answer yet, no match, a failure) [local].
 */
export const ytSearchArtistSongs = <S extends YtSong>(
  section: YtSection<S>,
  local: number,
  saved: YtArtistSaved<S> | null,
  context: { readonly now: number; readonly inLibrary: (song: S) => boolean },
): number => {
  if (ytSectionToggle(section) !== "online") return local;
  return ytArtistMergedCounts({ albums: 0, songs: local }, saved, { ...context, libraryRelease })
    .songs;
};
