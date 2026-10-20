/**
 * How much of each mix is new music (docs/spec.md, "Artist mixes"): a level
 * from 1 (20% new songs, the rest familiar) to 5 (all new). A build stores
 * each mix's new songs (enough for level 5) and its familiar share; the
 * level only re-blends what's stored, so changing it needs no network and no
 * rebuild.
 */

import { splitCredit } from "./credits.ts";
import type {
  DiscoverLibrarySong,
  DiscoverMix,
  DiscoverMixFamiliarSong,
  DiscoverMixLibrarySong,
  DiscoverMixSeed,
  DiscoverRadioSong,
  DiscoverSeedArtist,
  DiscoverSeedSong,
  DiscoverSongPlays,
} from "./discoverMixes.ts";
import { mixLibrarySong, mixRecordingOf, mixSeedArtists } from "./discoverMixes.ts";
import { isExplicit, type ExplicitFlag } from "./explicit.ts";
import { ofGenreFamily } from "./genreMixes.ts";
import { identityKey } from "./library.ts";
import type { MixKnownSongs } from "./mixKnownSongs.ts";
import type { MixedSong, YtAlbumSong } from "./ytDiscover.ts";

/** How much of each mix is new: 1 = 20% new songs, up to 5 = all new. */
export type DiscoverMixLevel = 1 | 2 | 3 | 4 | 5;

/**
 * A song of a mix as it plays: one of the Library's, or one that streams: a
 * new one, or a familiar one ([familiar]) the phone has no file for.
 */
export type DiscoverMixSong =
  | {
      readonly source: "stream";
      readonly song: YtAlbumSong;
      /** A song of the familiar share, not a new one; absent for a new one. */
      readonly familiar?: true;
    }
  | { readonly source: "library"; readonly track: DiscoverMixLibrarySong };

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
   * Library, a new song the owner doesn't know yet); absent, every one.
   * Applied before blending, so the shares hold.
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
  /**
   * The videos of the songs the owner has streamed, or has in a playlist,
   * now: a new song among them was played or added since the build, so it's
   * left out. Absent: none.
   */
  readonly knownVideos?: ReadonlySet<string>;
}

/**
 * The songs a mix keeps (`DiscoverMixBlend.keep`): Library songs still in
 * the Library, new songs the owner hasn't streamed or put in a playlist
 * since the build ([knownVideos]), and, while Don't play explicit is on,
 * clean ones alone (unknown counts as clean). Turning the switch over
 * re-blends the saved mixes; nothing is built again.
 */
export const discoverMixKeep =
  ({ dontPlayExplicit, library, knownVideos }: DiscoverMixKeep) =>
  (song: DiscoverMixSong): boolean => {
    if (song.source === "stream") {
      if (song.familiar !== true && knownVideos?.has(song.song.videoId) === true) return false;
      return !(dontPlayExplicit && isExplicit(song.song.explicit));
    }
    const known = library === null ? undefined : library.get(song.track.id);
    if (library !== null && known === undefined) return false;
    const flag = known?.explicit ?? song.track.explicit ?? "unknown";
    return !(dontPlayExplicit && isExplicit(flag));
  };

/** How many levels there are: level n makes n fifths of a mix new. */
const LEVELS = 5;

/** The level of a fresh install. */
export const DEFAULT_DISCOVER_MIX_LEVEL: DiscoverMixLevel = 3;

/** The levels Discover's New music slider offers, from mostly familiar to all new. */
export const DISCOVER_MIX_LEVELS: readonly {
  readonly level: DiscoverMixLevel;
  readonly label: string;
  /** How much of what Discover plays is new at it ("60% new"). */
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

/**
 * What Discover's New music slider says at [level]: the step's name and its
 * share ("Balanced · 60% new"). One scale for the Magic Queue and the mixes
 * (`magicQueueShare`).
 */
export const discoverLevelLabel = (level: DiscoverMixLevel): string => {
  const entry = DISCOVER_MIX_LEVELS.find((candidate) => candidate.level === level)!;
  return `${entry.label} · ${entry.share}`;
};

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
 * level fifths of them new (rounded) and the rest from its familiar share,
 * in the share's order, interleaved from a new song. The songs [keep] refuses
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
  const pool = (mix.familiar ?? [])
    .map((song): DiscoverMixSong =>
      song.source === "stream" ? { source: "stream", song: song.song, familiar: true } : song,
    )
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

/** The songs the shares of the mixes before this one have. */
export interface DiscoverMixTaken {
  /** Library songs, by id. */
  readonly tracks: ReadonlySet<number>;
  /** Songs that stream, by video. */
  readonly videos: ReadonlySet<string>;
}

/** What a mix's familiar share is picked from. */
export interface DiscoverMixPoolSources<L extends DiscoverLibrarySong> {
  /** Its seed's radio, as read, in order. */
  readonly radio: readonly (DiscoverRadioSong & { readonly albumId: string | null })[];
  /** The songs the owner knows (`mixKnownSongs`), over [library]'s songs. */
  readonly known: MixKnownSongs<L>;
  readonly library: {
    readonly artists: readonly DiscoverSeedArtist[];
    readonly songs: readonly DiscoverLibrarySong[];
    /** The Library songs' all-time counted plays (songs not listed have none). */
    readonly plays?: readonly DiscoverSongPlays[];
  };
  /** What the shares of the mixes before this one have. */
  readonly taken: DiscoverMixTaken;
  /** How many new songs the mix has: its length. */
  readonly length: number;
}

/**
 * The songs [seed]'s mix may play as its familiar share, in the order the
 * share takes them: first the songs the owner knows that its radio played,
 * in the radio's order (music videos aside), the Library's as Library songs
 * and the others streamed as the radio has them; then the Library's songs of
 * its genre family, or, for a mix without one, of its seed artist, the most
 * played and then the newest first; then the non-D songs the owner knows
 * (streamed or in a playlist) by its seed artists, the most streamed and
 * then the newest first. Never a song twice or one an earlier mix's share
 * has ([taken]); as many as level 1 takes at most.
 */
export const discoverMixFamiliarPool = <L extends DiscoverLibrarySong>(
  seed: DiscoverMixSeed,
  { radio, known, library, taken, length }: DiscoverMixPoolSources<L>,
): DiscoverMixFamiliarSong[] => {
  const most = length - Math.round(length / LEVELS);
  const plays = new Map((library.plays ?? []).map((entry) => [entry.id, entry.countedPlays]));
  const playsOf = (song: DiscoverSeedSong): number => plays.get(song.id) ?? 0;
  const tracks = new Set(taken.tracks);
  const videos = new Set(taken.videos);
  const recordings = new Set<string>();
  const pool: DiscoverMixFamiliarSong[] = [];
  const addTrack = (song: DiscoverSeedSong): void => {
    if (pool.length >= most || tracks.has(song.id)) return;
    tracks.add(song.id);
    pool.push({ source: "library", track: mixLibrarySong(song) });
  };
  const addStream = (song: YtAlbumSong): void => {
    const recording = mixRecordingOf(song);
    if (pool.length >= most || videos.has(song.videoId) || recordings.has(recording)) return;
    videos.add(song.videoId);
    recordings.add(recording);
    pool.push({ source: "stream", song });
  };
  for (const { video, ...song } of radio) {
    if (video) continue;
    const track = known.inLibrary(song);
    if (track !== null) addTrack(track);
    else if (known.known(song)) addStream(song);
  }
  const rest = library.songs
    .filter(mixSongFilter(seed, library.artists))
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts the fresh array filter made; Hermes lacks toSorted
    .sort((a, b) => playsOf(b) - playsOf(a) || b.addedAt - a.addedAt);
  for (const song of rest) addTrack(song);
  const seedArtists = new Set(mixSeedArtists(seed).map((artist) => identityKey(artist.name)));
  for (const { song } of known.nonD) {
    const artists = song.artists.flatMap((artist) => splitCredit(artist)).map(identityKey);
    if (artists.some((artist) => seedArtists.has(artist))) addStream(song);
  }
  return pool;
};

/** Whether a Library song is of [seed]'s mix: of its genre family (`ofGenreFamily`), else by one of its seed's artists. */
const mixSongFilter = (
  seed: DiscoverMixSeed,
  artists: readonly DiscoverSeedArtist[],
): ((song: DiscoverLibrarySong) => boolean) => {
  if (seed.genre !== undefined) return ofGenreFamily(seed.genre);
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
