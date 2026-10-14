/**
 * What Search has asked YouTube Music: the songs, artists and albums it found
 * for what's typed, which join the Library's results (the integrated view). Typing alone asks only
 * when the Library has nothing for the query; otherwise Search offers Search
 * YouTube Music, and once the user taps it the view follows the query until
 * the field is cleared. It loads in the background, keeps the last results up
 * while the next query loads, drops answers to queries that are no longer
 * typed, and turns a failure into a quiet line. Off in Settings, it stays
 * hidden and nothing is requested.
 */

import { createSearchIndex, type SearchEntry } from "./search.ts";
import type { YtArtistAlbum, YtArtistCandidate } from "./ytArtist.ts";
import type { YtSong } from "./ytMusic.ts";

/** Why the section shows a quiet line instead of results. */
export type YtQuietReason = "offline" | "failed";

/**
 * Who asked YT Music: the user, with Search YouTube Music, or Search on its
 * own because the Library has nothing for the query.
 */
export type YtAskedBy = "user" | "auto";

/** What YT Music found for a query: its songs, artists and albums, each in its order. */
export interface YtSearchAnswer<S extends YtSong = YtSong> {
  readonly songs: readonly S[];
  readonly artists: readonly YtArtistCandidate[];
  readonly albums: readonly YtArtistAlbum[];
}

const NO_ANSWER: YtSearchAnswer<never> = { songs: [], artists: [], albums: [] };

/** The section's state; [S] is the song as the caller has it (the native result, say). */
export type YtSection<S extends YtSong = YtSong> =
  | { readonly status: "hidden" }
  /** The Library has results for [query]: nothing is asked, Search offers to ask. */
  | { readonly status: "offered"; readonly query: string }
  /**
   * [songs], [artists] and [albums] are the last results, kept up until the
   * new ones arrive. YT Music is asked [delayMs] from now: at once when
   * tapped, once typing pauses.
   */
  | ({
      readonly status: "loading";
      readonly query: string;
      readonly by: YtAskedBy;
      readonly delayMs: number;
    } & YtSearchAnswer<S>)
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
    }
  /** Search YouTube Music was tapped. */
  | { readonly type: "asked" }
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

/** A line the section shows instead of (or until) results. */
export type YtSectionNote = "searching" | "noMatches" | "allInLibrary" | YtQuietReason;

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
   * has nothing for the query.
   */
  readonly top: YtSearchTop<S> | null;
  readonly note: YtSectionNote | null;
  /** Search YouTube Music is offered: nothing is asked yet for the query. */
  readonly offer: boolean;
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
 * What the section shows, or null when it's hidden: YT Music's songs, artists
 * and albums, each in its order, minus those the Library already has, which
 * already show as the Library's.
 */
export const ytSectionView = <S extends YtSong>(
  section: YtSection<S>,
  library: YtSearchLibrary<S>,
): YtSectionView<S> | null => {
  switch (section.status) {
    case "hidden":
      return null;
    case "offered":
      return { ...QUIET, note: null, offer: true, integrated: false };
    case "quiet":
      return { ...QUIET, note: section.reason, offer: false, integrated: false };
    case "loading":
    case "results": {
      const shown: YtSearchAnswer<S> = {
        songs: section.songs.filter((song) => !library.hasSong(song)),
        artists: section.artists.filter((artist) => !library.hasArtist(artist)),
        albums: section.albums.filter((album) => !library.hasAlbum(album)),
      };
      const view = { ...shown, top: ytTop(section.query, shown), offer: false, integrated: true };
      if (isEmpty(shown)) {
        const note =
          section.status === "loading"
            ? "searching"
            : isEmpty(section)
              ? "noMatches"
              : "allInLibrary";
        return { ...view, note };
      }
      return { ...view, note: null };
    }
  }
};

const isEmpty = (answer: YtSearchAnswer<YtSong>): boolean =>
  answer.songs.length === 0 && answer.artists.length === 0 && answer.albums.length === 0;

/** What's shown of the last answer, kept up while the next query loads. */
const shownAnswer = <S extends YtSong>(state: YtSection<S>): YtSearchAnswer<S> =>
  state.status === "loading" || state.status === "results"
    ? { songs: state.songs, artists: state.artists, albums: state.albums }
    : NO_ANSWER;

/** Who asked YT Music, or null when it isn't asked (hidden, or only offered). */
const askedBy = <S extends YtSong>(state: YtSection<S>): YtAskedBy | null =>
  state.status === "hidden" || state.status === "offered" ? null : state.by;

export const stepYtSection = <S extends YtSong>(
  state: YtSection<S>,
  event: YtSectionEvent<S>,
): YtSection<S> => {
  switch (event.type) {
    case "typed": {
      const query = event.enabled ? ytSearchQuery(event.query) : null;
      if (query === null) return YT_SECTION_HIDDEN;
      const was = askedBy(state);
      // Asked by the user, it follows the query; on its own, only while the Library has nothing.
      const by = was === "user" ? "user" : event.libraryHasResults ? null : "auto";
      if (by === null)
        return state.status === "offered" && state.query === query
          ? state
          : { status: "offered", query };
      if (was === by && state.status !== "hidden" && state.query === query) return state;
      return {
        status: "loading",
        query,
        ...shownAnswer(state),
        by,
        delayMs: YT_SEARCH_DEBOUNCE_MS,
      };
    }
    case "asked":
      if (state.status !== "offered") return state;
      return { status: "loading", query: state.query, ...NO_ANSWER, by: "user", delayMs: 0 };
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
