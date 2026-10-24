/**
 * The seed songs whose radios a playlist's suggestions read (docs/spec.md,
 * Playlist recommendations): 3 of its songs by different artists, leaning to
 * the most recently added, and changing from one renewal to the next.
 */
import type { PlaylistRecommendationTrack } from "./playlistRecommendations.ts";
import { drawSeedSongs } from "./seedSongDraw.ts";
import type { RandomSource } from "./weightedPick.ts";

/** How many of a playlist's latest seeds its next draws avoid. */
export const PLAYLIST_SEED_RECENT = 30;

/** How many playlists keep their draws: the latest ones drawn. */
export const PLAYLIST_SEED_PLAYLISTS = 200;

/** Each playlist's recent seed song ids, oldest first. */
export type PlaylistSeedHistory = ReadonlyMap<number, readonly string[]>;

/**
 * A renewal's seeds from [playlist]: up to 3 songs by different primary
 * artists, weighted to the latest `addedAt` (`drawSeedSongs`, `weight:
 * "added"`), avoiding [recent] while other songs remain. [recent] after
 * the draw comes back with it, for the next renewal. [kept], the seeds
 * already drawn, stand (as the playlist holds them now) while every one of
 * them is still in [playlist], and nothing is drawn.
 */
export const drawPlaylistSeeds = (
  playlist: readonly PlaylistRecommendationTrack[],
  {
    recent,
    random,
    kept = [],
  }: {
    readonly recent: readonly string[];
    readonly random: RandomSource;
    readonly kept?: readonly PlaylistRecommendationTrack[];
  },
): { readonly seeds: PlaylistRecommendationTrack[]; readonly recent: readonly string[] } => {
  const byId = new Map(playlist.map((track) => [track.id, track]));
  if (kept.length > 0 && kept.every((seed) => byId.has(seed.id)))
    return { seeds: kept.map((seed) => byId.get(seed.id)!), recent };
  const drawn = drawSeedSongs(
    playlist.map((track) => ({
      id: track.id,
      artist: track.artists[0] ?? "",
      ...(track.addedAt === undefined ? {} : { addedAt: track.addedAt }),
    })),
    { weight: "added", recent, random },
  );
  const ids = new Set(drawn.map((seed) => seed.id));
  return {
    seeds: drawn.map((seed) => byId.get(seed.id)!),
    recent: [...recent.filter((id) => !ids.has(id)), ...ids].slice(-PLAYLIST_SEED_RECENT),
  };
};

/** [history] with playlist [id]'s [recent] draws, as its latest playlist. */
export const playlistSeedHistoryWith = (
  history: PlaylistSeedHistory,
  id: number,
  recent: readonly string[],
): PlaylistSeedHistory => {
  const next = new Map(history);
  next.delete(id);
  next.set(id, recent.slice(-PLAYLIST_SEED_RECENT));
  for (const old of next.keys()) {
    if (next.size <= PLAYLIST_SEED_PLAYLISTS) break;
    next.delete(old);
  }
  return next;
};

/** [history] as text, for `parsePlaylistSeedHistory`. */
export const storedPlaylistSeedHistory = (history: PlaylistSeedHistory): string =>
  JSON.stringify([...history]);

/** The history [text] stored; anything unreadable reads as none. */
export const parsePlaylistSeedHistory = (text: string | null): PlaylistSeedHistory => {
  if (text === null) return new Map();
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return new Map();
    const history = new Map<number, readonly string[]>();
    for (const entry of value)
      if (
        Array.isArray(entry) &&
        Number.isInteger(entry[0]) &&
        Array.isArray(entry[1]) &&
        entry[1].every((id: unknown) => typeof id === "string")
      )
        history.set(entry[0], entry[1]);
    return history;
  } catch {
    return new Map();
  }
};
