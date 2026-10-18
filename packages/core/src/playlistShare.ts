/**
 * Sharing a playlist on another service (docs/spec.md, "Sharing
 * playlists"): Wave makes the playlist on the signed-in account, with the
 * songs it can match there, and remembers it so sharing again updates the
 * same one. What's here is the same for YT Music and Spotify: which songs go
 * in, what the result says, and the edits that bring a shared playlist up
 * to date. The service-specific parts (what an id is, how a song is
 * searched) are the caller's.
 */

import type { AlertSpec } from "./alert.ts";
import { counted } from "./listening.ts";
import type { UnavailableEntry, UnsearchedEntry } from "./playlistEntries.ts";
import { spotifyYtMatch } from "./spotifyImport.ts";
import type { SpotifySong } from "./spotifyPlaylist.ts";
import type { YtSong } from "./ytMusic.ts";

/** A service a playlist can be shared on. */
export type PlaylistShareService = "ytMusic";

/** What a playlist's Share card calls each service. */
export const PLAYLIST_SHARE_LABELS: { readonly [S in PlaylistShareService]: string } = {
  ytMusic: "YT Music",
};

/** The services a playlist can be shared on now: YT Music while it's on in Settings. */
export const playlistShareServices = ({
  ytMusic,
}: {
  readonly ytMusic: boolean;
}): PlaylistShareService[] => (ytMusic ? ["ytMusic"] : []);

/** What sharing on [service] signed out asks: signing in, which it needs. */
export const shareSignInAlert = (
  service: PlaylistShareService,
): AlertSpec & { readonly action: NonNullable<AlertSpec["action"]> } => ({
  title: `Sign In to ${PLAYLIST_SHARE_LABELS[service]}`,
  message:
    "Sharing a playlist makes an unlisted copy of it on your YouTube Music account, with a link anyone can open.",
  action: { label: "Sign In" },
});

/** The link to the YT Music playlist [playlistId], as sharing sends it. */
export const ytMusicPlaylistUrl = (playlistId: string): string =>
  `https://music.youtube.com/playlist?list=${playlistId}`;

/** How many edits one request to the service carries. */
const EDITS_PER_REQUEST = 100;

/** [edits] in requests' worth, in order: applied one request after another, they stay in order. */
export const sharedEditBatches = <E>(edits: readonly E[]): E[][] => {
  const batches: E[][] = [];
  for (let start = 0; start < edits.length; start += EDITS_PER_REQUEST)
    batches.push(edits.slice(start, start + EDITS_PER_REQUEST));
  return batches;
};

/**
 * A playlist's song as the service sees it: its id there when Wave knows it
 * (a YouTube video id), otherwise what to search it by, or nothing when
 * it can't be searched.
 */
export interface ShareSong<Q> {
  readonly id: string | null;
  readonly search?: Q | undefined;
}

/** The songs a shared playlist gets: their ids in the playlist's order, and how many of its songs were found. */
export interface SharedSongs {
  readonly ids: readonly string[];
  readonly found: number;
  readonly total: number;
}

/**
 * Matches [songs] on the service: a known id as it is, a song without one
 * searched once with [search] (in order, one at a time, so a shared search
 * allowance paces them), and a song with neither left out. A song listed
 * twice goes in once, where it first comes. Rejects when [search] does.
 */
export const matchSharedSongs = async <Q>(
  songs: readonly ShareSong<Q>[],
  search: (query: Q) => Promise<string | null>,
): Promise<SharedSongs> => {
  const ids: string[] = [];
  const seen = new Set<string>();
  let found = 0;
  for (const song of songs) {
    const id = song.id ?? (song.search === undefined ? null : await search(song.search));
    if (id === null) continue;
    found += 1;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { ids, found, total: songs.length };
};

/** What sharing says when it's done: "12 of 15 songs found". */
export const sharedSongsLine = ({ found, total }: Pick<SharedSongs, "found" | "total">): string =>
  `${found.toLocaleString("en")} of ${counted(total, "song")} found`;

/**
 * An entry of a playlist Wave shared, as the service lists it: the song's
 * [id], and [entryId], the entry itself (YouTube's `setVideoId`), which edits
 * name.
 */
export interface SharedEntry {
  readonly id: string;
  readonly entryId: string;
}

/** What brings a shared playlist's songs up to date, before putting them in order. */
export interface SharedPlaylistChanges {
  /** The entries to take out: songs no longer wanted, and a song's entries after its first. */
  readonly removes: readonly SharedEntry[];
  /** The songs to add, in the order wanted (they go at the end; `sharedPlaylistMoves` orders them). */
  readonly adds: readonly string[];
}

/** What turns the shared playlist [entries] into one holding the songs [wanted], each once. */
export const sharedPlaylistChanges = (
  entries: readonly SharedEntry[],
  wanted: readonly string[],
): SharedPlaylistChanges => {
  const wantedIds = new Set(wanted);
  const held = new Set<string>();
  const removes: SharedEntry[] = [];
  for (const entry of entries) {
    if (wantedIds.has(entry.id) && !held.has(entry.id)) held.add(entry.id);
    else removes.push(entry);
  }
  return { removes, adds: wanted.filter((id) => !held.has(id)) };
};

/** A move in a shared playlist: the entry [entryId] goes right before the entry [before], or to the end for null. */
export interface SharedMove {
  readonly entryId: string;
  readonly before: string | null;
}

/**
 * The indexes into [ranks] of a longest run of rising ranks (patience
 * sorting): the entries already in order among themselves, which stay put.
 */
const longestRising = (ranks: readonly number[]): Set<number> => {
  // tails[k]: the index ending the best run of length k + 1 found so far.
  const tails: number[] = [];
  const previous: number[] = [];
  ranks.forEach((rank, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((ranks[tails[middle] ?? 0] ?? 0) < rank) low = middle + 1;
      else high = middle;
    }
    previous[index] = low > 0 ? (tails[low - 1] ?? -1) : -1;
    tails[low] = index;
  });
  const kept = new Set<number>();
  for (let index = tails.at(-1) ?? -1; index !== -1; index = previous[index] ?? -1) kept.add(index);
  return kept;
};

/**
 * The moves that put the shared playlist [entries] (once it holds the songs
 * [wanted], `sharedPlaylistChanges`) in [wanted]'s order, applied one after
 * another: the fewest, as the longest run of entries already in order stays
 * where it is, and each other entry goes right before the song that follows
 * it, last song first.
 */
export const sharedPlaylistMoves = (
  entries: readonly SharedEntry[],
  wanted: readonly string[],
): SharedMove[] => {
  const entryOf = new Map(entries.map((entry) => [entry.id, entry.entryId]));
  const order = wanted.filter((id) => entryOf.has(id));
  const rankOf = new Map(order.map((id, rank) => [id, rank]));
  const placed = entries.filter((entry) => rankOf.has(entry.id));
  const kept = longestRising(placed.map((entry) => rankOf.get(entry.id) ?? 0));
  const stays = new Set(placed.filter((_, index) => kept.has(index)).map((entry) => entry.id));
  const moves: SharedMove[] = [];
  for (let rank = order.length - 1; rank >= 0; rank -= 1) {
    const id = order[rank] ?? "";
    if (stays.has(id)) continue;
    const next = order[rank + 1];
    moves.push({
      entryId: entryOf.get(id) ?? "",
      before: next === undefined ? null : (entryOf.get(next) ?? null),
    });
  }
  return moves;
};

/**
 * A playlist's song as sharing it on YT Music sees it: a Library song with
 * the YouTube video id it was downloaded from (or null), a YT Music entry,
 * or an import's unsearched or unavailable entry.
 */
export type YtShareItem =
  | { readonly source: "library"; readonly videoId: string | null; readonly song: SpotifySong }
  | { readonly source: "stream"; readonly song: Pick<YtSong, "videoId"> }
  | UnsearchedEntry
  | UnavailableEntry;

/**
 * How [item] is shared on YT Music: by its video id when it has one, else
 * searched by its title and artists (a Library song, an unsearched entry).
 * An unavailable entry is left out: YouTube Music didn't have it when it was
 * searched, or it can't be searched.
 */
export const ytShareSong = (item: YtShareItem): ShareSong<SpotifySong> => {
  switch (item.source) {
    case "library":
      return item.videoId === null ? { id: null, search: item.song } : { id: item.videoId };
    case "stream":
      return { id: item.song.videoId };
    case "unsearched":
      return { id: null, search: item.song };
    case "unavailable":
      return { id: null };
  }
};

/**
 * The video id of [song] among [results], a YouTube Music Songs search for
 * its title and artists: the first that is the same recording, by the rules
 * imports use (`spotifyYtMatch`), or null.
 */
export const ytShareMatch = (song: SpotifySong, results: readonly YtSong[]): string | null =>
  spotifyYtMatch(song, results)?.videoId ?? null;
