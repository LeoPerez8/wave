/**
 * Fix Song's online lookups on the desktop, as the phone's `lookUpLyricsAndGenre` makes them: a
 * song's lyrics on LRCLIB (synced preferred) and, on Deezer, its album's genre and year, its
 * track number and whether it's explicit, all matched by Core. Only the title, artist, album and
 * length are sent. Each service settles on its own (Core's `settledTags`).
 */
import {
  LRCLIB_HEADERS,
  deezerAlbum,
  deezerAlbumTracks,
  deezerAlbumTracksUrl,
  deezerAlbumUrl,
  deezerFollowUps,
  deezerTags,
  deezerTrackCandidates,
  deezerTrackSearchUrl,
  fixLookups,
  lrclibCandidates,
  lrclibSearchUrl,
  pickDeezerTrack,
  pickFoundLyrics,
  settledTags,
  type DeezerAlbum,
  type DeezerAlbumTrack,
  type DeezerTags,
  type FoundTags,
  type IndexedTags,
  type SongLookup,
  type TagLookup,
} from "@wave/core";

/** A lookup (every request it makes) that takes longer than this has failed. */
const LOOKUP_TIMEOUT_MS = 30_000;

/** A song with nothing yet (a download being tagged): everything is looked up. */
const HAS_NOTHING: IndexedTags = {
  hasLyrics: false,
  genre: null,
  trackNumber: null,
  year: null,
  explicit: "unknown",
};

export interface Lookups {
  /**
   * What [song] lacks, given what it [has]: null when no service asked answered (or none had to
   * be asked and nothing was found). Never rejects.
   */
  readonly lookUp: (song: SongLookup, has?: IndexedTags) => Promise<FoundTags | null>;
}

export const createLookups = (fetch: typeof globalThis.fetch = globalThis.fetch): Lookups => {
  const albums = new Map<number, DeezerAlbum>();
  const tracklists = new Map<number, readonly DeezerAlbumTrack[]>();
  const getJson = async (url: string, signal: AbortSignal, headers?: Record<string, string>) => {
    const response = await fetch(url, { signal, ...(headers === undefined ? {} : { headers }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as unknown;
  };
  const findAlbum = async (albumId: number, signal: AbortSignal) => {
    const known = albums.get(albumId);
    if (known !== undefined) return known;
    const album = deezerAlbum(await getJson(deezerAlbumUrl(albumId), signal));
    if (album === null) throw new Error("Deezer didn't answer with an album");
    albums.set(albumId, album);
    return album;
  };
  const findTracklist = async (albumId: number, signal: AbortSignal) => {
    const known = tracklists.get(albumId);
    if (known !== undefined) return known;
    try {
      const tracklist = deezerAlbumTracks(await getJson(deezerAlbumTracksUrl(albumId), signal));
      if (tracklist !== null) tracklists.set(albumId, tracklist);
      return tracklist;
    } catch {
      // The genre and year still count.
      return null;
    }
  };
  const findDeezerTags = async (
    song: SongLookup,
    has: IndexedTags,
    signal: AbortSignal,
  ): Promise<DeezerTags | null> => {
    const tracks = deezerTrackCandidates(await getJson(deezerTrackSearchUrl(song), signal));
    if (tracks === null) throw new Error("Deezer didn't answer with search results");
    const match = pickDeezerTrack(song, tracks);
    if (match === null) return null;
    const next = deezerFollowUps(has, match);
    const album = next.album ? await findAlbum(match.albumId, signal) : null;
    const tracklist = next.tracklist ? await findTracklist(match.albumId, signal) : null;
    return deezerTags(match, album, tracklist);
  };
  const findLyrics = async (song: SongLookup, signal: AbortSignal) => {
    const candidates = lrclibCandidates(
      await getJson(lrclibSearchUrl(song), signal, LRCLIB_HEADERS),
    );
    if (candidates === null) throw new Error("LRCLIB didn't answer with search results");
    return pickFoundLyrics(song, candidates);
  };
  const settle = async <A>(find: (signal: AbortSignal) => Promise<A>): Promise<TagLookup<A>> => {
    try {
      return { ok: true, value: await find(AbortSignal.timeout(LOOKUP_TIMEOUT_MS)) };
    } catch {
      return { ok: false };
    }
  };
  return {
    lookUp: async (song, has = HAS_NOTHING) => {
      const ask = fixLookups(has);
      const [lyrics, deezer] = await Promise.all([
        ask.lyrics ? settle((signal) => findLyrics(song, signal)) : null,
        ask.deezer ? settle((signal) => findDeezerTags(song, has, signal)) : null,
      ]);
      return settledTags(lyrics, deezer);
    },
  };
};
