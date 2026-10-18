/**
 * How much of each Discover mix is new music (docs/spec.md, "Discover
 * mixes"): a level from 1 (20% new songs, the rest the Library's) to 5 (all
 * new). A build stores each mix's new songs (enough for level 5) and its
 * Library pool; the level only re-blends what's stored, so changing it needs
 * no network and no rebuild.
 */

import type {
  DiscoverLibrarySong,
  DiscoverMix,
  DiscoverMixLibrarySong,
  DiscoverMixSeed,
  DiscoverRadioSong,
  DiscoverSeedArtist,
  DiscoverSeedSong,
  DiscoverSongPlays,
} from "./discoverMixes.ts";
import { mixLibrarySong } from "./discoverMixes.ts";
import { isExplicit, type ExplicitFlag } from "./explicit.ts";
import { identityKey } from "./library.ts";
import type { MixedSong, YtAlbumSong } from "./ytDiscover.ts";

/** How much of each mix is new: 1 = 20% new songs, up to 5 = all new. */
export type DiscoverMixLevel = 1 | 2 | 3 | 4 | 5;

/** A song of a mix as it plays: a new one, streamed, or one of the Library's. */
export type DiscoverMixSong = MixedSong<YtAlbumSong, DiscoverMixLibrarySong>;

/** A mix as the owner's level makes it: what Home, its page and its actions show and play. */
export interface BlendedDiscoverMix {
  readonly id: DiscoverMix["id"];
  readonly seed: DiscoverMix["seed"];
  readonly songs: readonly DiscoverMixSong[];
}

/** What a mix is blended by. */
export interface DiscoverMixBlend {
  readonly level: DiscoverMixLevel;
  /**
   * Whether the mix may play a song of its pools (a Library song still in the
   * Library); absent, every one. Applied before blending, so the shares hold.
   */
  readonly keep?: (song: DiscoverMixSong) => boolean;
}

/** What a mix may play of its stored songs. */
export interface DiscoverMixKeep {
  /** Don't play explicit is on: explicit songs (new or the Library's) are left out. */
  readonly dontPlayExplicit: boolean;
  /**
   * The Library's songs by id, or null when they aren't read (Home): a pool
   * song it no longer has is left out, and its flag is the Library's, not
   * the one the build saved.
   */
  readonly library: ReadonlyMap<number, { readonly explicit: ExplicitFlag }> | null;
}

/**
 * The songs a mix keeps (`DiscoverMixBlend.keep`): Library songs still in
 * the Library, and, while Don't play explicit is on, clean ones alone
 * (unknown counts as clean). Turning the switch over re-blends the saved
 * mixes; nothing is built again.
 */
export const discoverMixKeep =
  ({ dontPlayExplicit, library }: DiscoverMixKeep) =>
  (song: DiscoverMixSong): boolean => {
    if (song.source === "stream") return !(dontPlayExplicit && isExplicit(song.song.explicit));
    const known = library === null ? undefined : library.get(song.track.id);
    if (library !== null && known === undefined) return false;
    const flag = known?.explicit ?? song.track.explicit ?? "unknown";
    return !(dontPlayExplicit && isExplicit(flag));
  };

/** How many levels there are: level n makes n fifths of a mix new. */
const LEVELS = 5;

/** The level of a fresh install. */
export const DEFAULT_DISCOVER_MIX_LEVEL: DiscoverMixLevel = 3;

/** The levels the section header's control offers, from mostly familiar to all new. */
export const DISCOVER_MIX_LEVELS: readonly {
  readonly level: DiscoverMixLevel;
  readonly label: string;
  /** How much of each mix is new at it ("60% new"): the control's own label. */
  readonly share: string;
}[] = (
  [
    [1, "Mostly familiar"],
    [2, "More familiar"],
    [3, "Balanced"],
    [4, "Mostly new"],
    [5, "All new"],
  ] as const
).map(([level, label]) => ({ level, label, share: `${(level * 100) / LEVELS}% new` }));

/** The level kept on the phone ([stored], null for none): 3 for anything that isn't one. */
export const readDiscoverMixLevel = (stored: string | null): DiscoverMixLevel =>
  DISCOVER_MIX_LEVELS.find((entry) => String(entry.level) === stored)?.level ??
  DEFAULT_DISCOVER_MIX_LEVEL;

/**
 * [fresh] and [familiar] taking turns as evenly as their counts allow, from
 * a new song: each place is new while the new songs so far are behind their
 * share of the places so far.
 */
const interleave = <A, B>(fresh: readonly A[], familiar: readonly B[]): (A | B)[] => {
  const total = fresh.length + familiar.length;
  const newBy = (places: number): number => Math.ceil((places * fresh.length) / total);
  const songs: (A | B)[] = [];
  let next = { fresh: 0, familiar: 0 };
  for (let at = 0; at < total; at++) {
    if (newBy(at + 1) > newBy(at)) {
      songs.push(fresh[next.fresh]!);
      next = { ...next, fresh: next.fresh + 1 };
    } else {
      songs.push(familiar[next.familiar]!);
      next = { ...next, familiar: next.familiar + 1 };
    }
  }
  return songs;
};

/**
 * [mix] at [level]: as many songs as it has new ones (its level-5 length),
 * level fifths of them new (rounded) and the rest from its Library pool, in
 * the pool's order, interleaved from a new song. The songs [keep] refuses
 * are out of both pools first; the length stays the stored new songs'. A
 * pool too short for the familiar share leaves the rest to new songs, and
 * too few new songs (explicit ones left out) leave theirs to the pool, so
 * the mix keeps its length as far as both pools go. Every reading of a
 * saved mix (Home, its page, its actions) goes through this.
 */
export const blendDiscoverMix = (
  mix: DiscoverMix,
  { level, keep = () => true }: DiscoverMixBlend,
): BlendedDiscoverMix => {
  const fresh = mix.songs.map((song): DiscoverMixSong => ({ source: "stream", song })).filter(keep);
  const pool = (mix.library ?? [])
    .map((track): DiscoverMixSong => ({ source: "library", track }))
    .filter(keep);
  const length = mix.songs.length;
  const freshShare = Math.min(fresh.length, Math.round((length * level) / LEVELS));
  const familiar = pool.slice(0, length - freshShare);
  return {
    id: mix.id,
    seed: mix.seed,
    songs: interleave(fresh.slice(0, length - familiar.length), familiar),
  };
};

/** What a mix's Library pool is picked from. */
export interface DiscoverMixPoolSources<S extends DiscoverRadioSong> {
  /** Its seed's radio, as read, in order. */
  readonly radio: readonly S[];
  /** The Library song a radio song is (Core's `libraryFinder`), or null. */
  readonly find: (song: S) => DiscoverSeedSong | null;
  readonly library: {
    readonly artists: readonly DiscoverSeedArtist[];
    readonly songs: readonly DiscoverLibrarySong[];
    /** The Library songs' all-time counted plays (songs not listed have none). */
    readonly plays?: readonly DiscoverSongPlays[];
  };
  /** The Library songs the pools of the mixes before this one have, by id. */
  readonly taken: ReadonlySet<number>;
  /** How many new songs the mix has: its length. */
  readonly length: number;
}

/**
 * The Library songs [seed]'s mix may play as its familiar share, in the order
 * the share takes them: first the ones its radio played, in the radio's
 * order (music videos aside), then the Library's songs of its genre, or, for
 * a mix without one, of its seed artist, the most played and then the
 * newest first. Never a song twice or one an earlier mix's pool has
 * ([taken]); as many as level 1 takes at most.
 */
export const discoverMixLibraryPool = <S extends DiscoverRadioSong>(
  seed: DiscoverMixSeed,
  { radio, find, library, taken, length }: DiscoverMixPoolSources<S>,
): DiscoverMixLibrarySong[] => {
  const most = length - Math.round(length / LEVELS);
  const plays = new Map((library.plays ?? []).map((entry) => [entry.id, entry.countedPlays]));
  const playsOf = (song: DiscoverSeedSong): number => plays.get(song.id) ?? 0;
  const seen = new Set(taken);
  const pool: DiscoverMixLibrarySong[] = [];
  const add = (song: DiscoverSeedSong): void => {
    if (pool.length >= most || seen.has(song.id)) return;
    seen.add(song.id);
    pool.push(mixLibrarySong(song));
  };
  for (const song of radio) {
    if (song.video) continue;
    const track = find(song);
    if (track !== null) add(track);
  }
  const rest = library.songs
    .filter(mixSongFilter(seed, library.artists))
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts the fresh array filter made; Hermes lacks toSorted
    .sort((a, b) => playsOf(b) - playsOf(a) || b.addedAt - a.addedAt);
  for (const song of rest) add(song);
  return pool;
};

/** Whether a Library song is of [seed]'s mix: of its genre, else by one of its seed's artists. */
const mixSongFilter = (
  seed: DiscoverMixSeed,
  artists: readonly DiscoverSeedArtist[],
): ((song: DiscoverLibrarySong) => boolean) => {
  if (seed.genre !== undefined) {
    const genre = identityKey(seed.genre.trim());
    return (song) => genre !== "" && identityKey(song.genre?.trim() ?? "") === genre;
  }
  const name = identityKey(seed.name);
  const ids = new Set(
    artists.filter((artist) => identityKey(artist.name) === name).map((artist) => artist.id),
  );
  return (song) => song.artistIds.some((id) => ids.has(id));
};

/**
 * [mix]'s songs as its list shows them and they play: its Library songs as
 * their Library tracks ([track], by id; one the Library no longer has is left
 * out), its new songs as the Library's track when it has the song since
 * ([find], a download), else streamed.
 */
export const placeDiscoverMixSongs = <L>(
  mix: BlendedDiscoverMix,
  {
    find,
    track,
  }: { readonly find: (song: YtAlbumSong) => L | null; readonly track: (id: number) => L | null },
): MixedSong<YtAlbumSong, L>[] =>
  mix.songs.flatMap((song): MixedSong<YtAlbumSong, L>[] => {
    const found = song.source === "stream" ? find(song.song) : track(song.track.id);
    if (found !== null) return [{ source: "library", track: found }];
    return song.source === "stream" ? [song] : [];
  });
