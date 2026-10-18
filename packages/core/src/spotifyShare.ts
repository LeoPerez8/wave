/**
 * Sharing a playlist on Spotify (docs/spec.md, "Sharing playlists"; the
 * research is docs/spotify-account.md): every song is searched with
 * Spotify's own `searchTracks` as the signed-in account, and a result counts
 * when it's the same recording. The playlist Wave made is read back with
 * `fetchPlaylist`, and found in the account's library with `libraryV3`. The
 * native module sends the requests; Core reads their answers. What's the
 * same for every service is `playlistShare.ts`.
 */

import type { UnavailableEntry, UnsearchedEntry } from "./playlistEntries.ts";
import type { SharedEntry, ShareSong } from "./playlistShare.ts";
import { artistNames, spotifyYtMatch } from "./spotifyImport.ts";
import type { SpotifySong } from "./spotifyPlaylist.ts";
import type { YtSong } from "./ytMusic.ts";

/**
 * A playlist's song as sharing it on Spotify sees it: a Library song, a YT
 * Music entry, or an import's unsearched or unavailable entry.
 */
export type SpotifyShareItem =
  | { readonly source: "library"; readonly song: SpotifySong }
  | {
      readonly source: "stream";
      readonly song: Pick<YtSong, "title" | "artists" | "album" | "durationMs">;
    }
  | UnsearchedEntry
  | UnavailableEntry;

/**
 * How [item] is shared on Spotify: searched by its title and artists (and
 * matched by its album and length too), whatever it is, since Wave knows no
 * Spotify ids. An unavailable entry is searched as well: YouTube Music
 * didn't have it, but Spotify may. A song with no artist to match it by
 * (a Spotify local file, a Library song tagged with none) is left out.
 */
export const spotifyShareSong = (item: SpotifyShareItem): ShareSong<SpotifySong> => {
  const { title, artists, album, durationMs } = item.song;
  if (artistNames(artists).length === 0) return { id: null };
  return { id: null, search: { title, artists, album, durationMs } };
};

type Json = Readonly<Record<string, unknown>>;

const object = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
const array = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;
const at = (value: unknown, ...path: readonly string[]): unknown =>
  path.reduce<unknown>((node, key) => object(node)?.[key], value);

/** A track in Spotify's search answer, as matching compares it. */
interface SpotifyTrack {
  readonly uri: string;
  readonly title: string;
  readonly artists: readonly string[];
  readonly album: string | null;
  readonly durationMs: number | null;
}

/** A `searchTracks` result, or null when it isn't a track Spotify plays. */
const searchTrack = (result: unknown): SpotifyTrack | null => {
  const data = at(result, "item", "data");
  if (text(at(data, "__typename")) !== "Track" || at(data, "playability", "playable") === false)
    return null;
  const uri = text(at(data, "uri"));
  const title = text(at(data, "name"));
  if (uri === null || title === null) return null;
  const durationMs = at(data, "duration", "totalMilliseconds");
  return {
    uri,
    title,
    artists: array(at(data, "artists", "items"))
      .map((artist) => text(at(artist, "profile", "name")))
      .filter((name) => name !== null),
    album: text(at(data, "albumOfTrack", "name")),
    durationMs: typeof durationMs === "number" && durationMs > 0 ? durationMs : null,
  };
};

/**
 * The track URI of [song] in [data], the `data` of a Spotify `searchTracks`
 * answer for its title and artists: the first result, in Spotify's order,
 * that is the same recording by the rules imports use (`spotifyYtMatch`:
 * title, artists, edition notes and a length within 3 seconds) and that
 * Spotify plays. Null when none is; undefined when [data] isn't a search
 * answer at all.
 */
export const spotifyShareMatch = (song: SpotifySong, data: unknown): string | null | undefined => {
  const items = at(data, "searchV2", "tracksV2", "items");
  if (!Array.isArray(items)) return undefined;
  const tracks = items.map(searchTrack).filter((track) => track !== null);
  return spotifyYtMatch(song, tracks)?.uri ?? null;
};

/** The `data` of a paged read's answer for the page starting at [offset]. */
export type SpotifyPageRead = (offset: number) => Promise<unknown>;

/** Spotify's answers for a playlist that isn't there: an unknown id, or a malformed one. */
const NOT_FOUND = new Set(["NotFound", "GenericError"]);

/**
 * The entries of the playlist sharing made, read page by page with [read]
 * (`fetchPlaylist`'s `data`): each entry's track (or local file) URI and its
 * uid, which removing and moving name. Null when it's gone: Spotify has no
 * such playlist, or the account can't edit it. Rejects on an answer that
 * isn't a playlist, rather than read it as empty.
 */
export const readSpotifySharedPlaylist = async (
  read: SpotifyPageRead,
): Promise<SharedEntry[] | null> => {
  const entries: SharedEntry[] = [];
  for (let offset = 0; ;) {
    const playlist = at(await read(offset), "playlistV2");
    const kind = text(at(playlist, "__typename"));
    if (kind !== null && NOT_FOUND.has(kind)) return null;
    if (at(playlist, "currentUserCapabilities", "canEditItems") === false) return null;
    const items = at(playlist, "content", "items");
    const total = at(playlist, "content", "totalCount");
    if (kind !== "Playlist" || !Array.isArray(items) || typeof total !== "number")
      throw new Error("Spotify answered something that isn't a playlist");
    for (const item of items) {
      const id = text(at(item, "itemV2", "data", "uri"));
      const entryId = text(at(item, "uid"));
      if (id !== null && entryId !== null) entries.push({ id, entryId });
    }
    offset += items.length;
    if (items.length === 0 || offset >= total) return entries;
  }
};

/**
 * Whether the playlist [uri] is in the account's library, read page by page
 * with [read] (`libraryV3`'s `data`, playlists only): a playlist deleted on
 * Spotify leaves it. Rejects on an answer that isn't the library.
 */
export const spotifyLibraryHas = async (uri: string, read: SpotifyPageRead): Promise<boolean> => {
  for (let offset = 0; ;) {
    const library = at(await read(offset), "me", "libraryV3");
    const items = at(library, "items");
    const total = at(library, "totalCount");
    if (!Array.isArray(items) || typeof total !== "number")
      throw new Error("Spotify answered something that isn't the library");
    if (
      items.some(
        (entry) =>
          text(at(entry, "item", "_uri")) === uri || text(at(entry, "item", "data", "uri")) === uri,
      )
    )
      return true;
    offset += items.length;
    if (items.length === 0 || offset >= total) return false;
  }
};
