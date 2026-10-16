/**
 * Discover mixes (docs/spec.md, "Home"): a Home shelf of mixes made of songs
 * the owner doesn't know yet. Each mix starts from one of the owner's most
 * played artists or songs and keeps what YouTube Music's radio for it plays
 * next, less what the Library has and what the owner has played. Core picks
 * the seeds, decides which radio songs a mix keeps and when the mixes are
 * built again; the native module reads the radio and the app saves the mixes.
 */

import { splitCredit } from "./credits.ts";
import { identityKey } from "./library.ts";
import { normalizeSearchText } from "./search.ts";
import { readStoredRecord } from "./storedJson.ts";
import { ytArtistQuery } from "./ytArtist.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";
import { libraryFinder, type YtSong } from "./ytMusic.ts";

/** How many mixes Home shows at most. */
export const DISCOVER_MIX_COUNT = 6;

/** A Library artist as seeding sees it, among the most played. */
export interface DiscoverSeedArtist {
  readonly id: number;
  readonly name: string;
}

/** A Library song as seeding sees it, among the most played. */
export interface DiscoverSeedSong {
  readonly id: number;
  readonly title: string;
  /** Its artist credit. */
  readonly artist: string;
  /** The Library artists its credit names. */
  readonly artistIds: readonly number[];
  readonly durationMs: number;
}

/** What a mix starts from: a most played artist, or a most played song. */
export type DiscoverMixSeed =
  | {
      readonly kind: "artist";
      /** Tells the mix apart from the others, and from itself on another day. */
      readonly id: string;
      readonly name: string;
    }
  | {
      readonly kind: "song";
      readonly id: string;
      /** The song's title. */
      readonly name: string;
      readonly song: DiscoverSeedSong;
    };

/** How many of the mixes start from artists when there are songs enough for the rest. */
const ARTIST_SEEDS = 3;

const songKey = (song: DiscoverSeedSong): string =>
  `${normalizeSearchText(song.title)}\u001f${normalizeSearchText(song.artist)}`;

/** [songs] without any crediting one of [artists], each recording once, in their order. */
const songsBeside = (
  songs: readonly DiscoverSeedSong[],
  artists: readonly DiscoverSeedArtist[],
): DiscoverSeedSong[] => {
  const taken = new Set(artists.map((artist) => artist.id));
  const seen = new Set<string>();
  return songs.filter((song) => {
    if (song.artistIds.some((id) => taken.has(id))) return false;
    const key = songKey(song);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * The mixes' seeds, from the owner's most played [artists] and [songs] (most
 * played first): three artists and three songs, taking turns from the most
 * played artist, a song by none of the artists seeding a mix (their mix has
 * it already). With too few of either, the other makes up the six. Names
 * that aren't an artist's ("Various Artists") seed nothing.
 */
export const discoverMixSeeds = ({
  artists,
  songs,
}: {
  readonly artists: readonly DiscoverSeedArtist[];
  readonly songs: readonly DiscoverSeedSong[];
}): DiscoverMixSeed[] => {
  const seen = new Set<string>();
  const named = artists.filter((artist) => {
    if (ytArtistQuery(artist.name) === null) return false;
    const key = identityKey(artist.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // One artist more at a time while short of six, as each may take songs crediting
  // them out of the rest; still short with every artist, the most seeds found.
  const seedsWith = (count: number) => {
    const chosen = named.slice(0, count);
    const besides = songsBeside(songs, chosen);
    return { chosen, besides, count: chosen.length + besides.length };
  };
  let best = seedsWith(ARTIST_SEEDS);
  for (
    let count = ARTIST_SEEDS + 1;
    best.count < DISCOVER_MIX_COUNT && count <= named.length;
    count++
  ) {
    const more = seedsWith(count);
    if (more.count > best.count) best = more;
  }
  const { chosen, besides } = best;
  const picked = besides.slice(0, DISCOVER_MIX_COUNT - chosen.length);
  const seeds: DiscoverMixSeed[] = [];
  for (let turn = 0; turn < Math.max(chosen.length, picked.length); turn++) {
    const artist = chosen[turn];
    if (artist !== undefined)
      seeds.push({ kind: "artist", id: `artist:${identityKey(artist.name)}`, name: artist.name });
    const song = picked[turn];
    if (song !== undefined)
      seeds.push({ kind: "song", id: `song:${song.id}`, name: song.title, song });
  }
  return seeds;
};

const FIELD = "\u001f";
const TRAILING_FEATURE = /\s(?:feat|ft|featuring)\s.*$/u;
const TRAILING_REMASTER = /\s(?:\d{4}\s)?remaster(?:ed)?(?:\s(?:\d{4}|version))*$/u;

/** A title as searched text without a trailing featured credit or remaster note. */
const playedTitle = (normalized: string): string => {
  const bare = normalized.replace(TRAILING_FEATURE, "").replace(TRAILING_REMASTER, "");
  return bare === "" ? normalized : bare;
};

const creditNames = (credit: string): string[] =>
  splitCredit(credit)
    .map(normalizeSearchText)
    .filter((name) => name !== "");

interface PlayedRecording {
  readonly album: string;
  readonly artists: ReadonlySet<string>;
}

/**
 * Whether a YT Music song is one the owner has played, given the recording
 * keys (Core's `recordingKey`) of the songs played: one with its title
 * (case, accents, punctuation, a featured credit and a remaster note aside)
 * whose album artist is one of the song's artists or, on a compilation, whose
 * album is the song's. Plays of YT Music songs streamed aren't recorded, so
 * this is how a song played and deleted since stays out of the mixes.
 */
export const playedFinder = (
  recordingKeys: readonly string[],
): ((song: Pick<YtSong, "title" | "artists" | "album">) => boolean) => {
  const byTitle = new Map<string, PlayedRecording[]>();
  for (const recording of recordingKeys) {
    const [album = "", albumArtist = "", title = ""] = recording.split(FIELD);
    if (title === "") continue;
    const key = playedTitle(title);
    const recordings = byTitle.get(key) ?? [];
    recordings.push({ album, artists: new Set(creditNames(albumArtist)) });
    byTitle.set(key, recordings);
  }
  return (song) => {
    const recordings = byTitle.get(playedTitle(normalizeSearchText(song.title)));
    if (recordings === undefined) return false;
    const artists = song.artists.flatMap(creditNames);
    const album = song.album === null ? "" : identityKey(song.album);
    return recordings.some(
      (recording) =>
        artists.some((artist) => recording.artists.has(artist)) ||
        (album !== "" && recording.album === album),
    );
  };
};

/** A song of YouTube Music's radio, which plays music videos too. */
export interface DiscoverRadioSong extends YtSong {
  /** A music video (an official, user or lyric video) rather than a song. */
  readonly video: boolean;
}

/** What a mix leaves out of its seed's radio. */
export interface DiscoverMixFilter<S extends DiscoverRadioSong> {
  /** Whether the Library has the song (Core's `libraryFinder`). */
  readonly inLibrary: (song: S) => boolean;
  /** Whether the owner has played the song (`playedFinder`). */
  readonly played: (song: S) => boolean;
  /** The songs the mixes before this one have, by video id. */
  readonly taken: ReadonlySet<string>;
  /** The video the radio started from, for a song seed. */
  readonly seedVideo: string | null;
}

/** The most songs a mix has. */
const MIX_MOST = 50;
/** A mix with this many songs stops reading its radio. */
const MIX_ENOUGH = 25;
/** The most pages of a radio a mix reads. */
const RADIO_PAGES = 3;

/**
 * A mix's songs from its seed's radio, as read so far ([pages], in order):
 * the songs, in the radio's order, the owner doesn't know yet. Music videos,
 * the seed, songs the Library has or the owner played, songs an earlier mix
 * has and a song the radio plays again are left out; 50 at most. Reading a
 * page at a time, pass the songs kept from the pages before as [before]:
 * they come first, and only the new pages' songs are looked at.
 */
export const discoverMixSongs = <S extends DiscoverRadioSong>(
  pages: readonly (readonly S[])[],
  filter: DiscoverMixFilter<S>,
  before: readonly S[] = [],
): S[] => {
  const recordingOf = (song: S): string =>
    `${normalizeSearchText(song.title)}${FIELD}${song.artists.map(normalizeSearchText).join(FIELD)}`;
  const videos = new Set(filter.taken);
  if (filter.seedVideo !== null) videos.add(filter.seedVideo);
  for (const song of before) videos.add(song.videoId);
  const recordings = new Set(before.map(recordingOf));
  const kept: S[] = [...before];
  for (const song of pages.flat()) {
    if (kept.length >= MIX_MOST) break;
    const recording = recordingOf(song);
    if (song.video || videos.has(song.videoId) || recordings.has(recording)) continue;
    if (filter.inLibrary(song) || filter.played(song)) continue;
    videos.add(song.videoId);
    recordings.add(recording);
    kept.push(song);
  }
  return kept;
};

/**
 * Whether to read another page of a seed's radio: after [pages] pages, the
 * mix has [kept] songs and the radio [more]. A mix reads until it has 25
 * songs, three pages at most.
 */
export const discoverMixReadsMore = ({
  pages,
  kept,
  more,
}: {
  readonly pages: number;
  readonly kept: number;
  readonly more: boolean;
}): boolean => more && kept < MIX_ENOUGH && pages < RADIO_PAGES;

/** A mix with fewer songs than this isn't one. */
const MIX_FEWEST = 10;

/** One of the mixes, as Home shows it and its page lists it. */
export interface DiscoverMix {
  /** Its seed's id (`DiscoverMixSeed`): the page's address. */
  readonly id: string;
  readonly seed: { readonly kind: DiscoverMixSeed["kind"]; readonly name: string };
  readonly songs: readonly YtAlbumSong[];
}

/**
 * The mix [seed] makes of [songs] (`discoverMixSongs`), or null when they're
 * fewer than ten: too few to be a mix.
 */
export const discoverMix = (
  seed: DiscoverMixSeed,
  songs: readonly (DiscoverRadioSong & { readonly albumId: string | null })[],
): DiscoverMix | null =>
  songs.length < MIX_FEWEST
    ? null
    : {
        id: seed.id,
        seed: { kind: seed.kind, name: seed.name },
        songs: songs.map(({ video: _video, ...song }) => song),
      };

/** How many of a mix's artists its tile names. */
const CAPTION_ARTISTS = 3;

/**
 * A mix's tile on Home: named after its seed, over the first three artists
 * it plays (each song's lead artist), with how many songs it has.
 */
export const discoverMixCaption = (
  mix: DiscoverMix,
): { readonly title: string; readonly artists: string; readonly line: string } => {
  const artists = new Map<string, string>();
  for (const song of mix.songs) {
    if (artists.size === CAPTION_ARTISTS) break;
    const lead = song.artists[0];
    if (lead === undefined) continue;
    const key = identityKey(lead);
    if (!artists.has(key)) artists.set(key, lead);
  }
  return {
    title: `${mix.seed.name} mix`,
    artists: [...artists.values()].join(", "),
    line: `${mix.songs.length} songs`,
  };
};

/** The mixes as last built, saved so Home shows them without waiting on YouTube Music. */
export interface DiscoverMixes {
  /** When they were built (ms since the epoch). */
  readonly builtAt: number;
  readonly mixes: readonly DiscoverMix[];
}

/** What to save for [mixes]. */
export const storedDiscoverMixes = (mixes: DiscoverMixes): string => JSON.stringify(mixes);

const isString = (value: unknown): value is string => typeof value === "string";
const isNullable = <T>(value: unknown, is: (value: unknown) => value is T): boolean =>
  value === null || is(value);
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readSong = (value: unknown): YtAlbumSong | null => {
  if (!isRecord(value)) return null;
  const { videoId, title, artists, album, albumId, durationMs, artworkUrl, explicit } = value;
  if (!isString(videoId) || videoId === "" || !isString(title)) return null;
  if (!Array.isArray(artists) || !artists.every(isString)) return null;
  if (!isNullable(album, isString) || !isNullable(albumId, isString)) return null;
  if (!isNullable(durationMs, isNumber) || !isNullable(artworkUrl, isString)) return null;
  if (typeof explicit !== "boolean") return null;
  return {
    videoId,
    title,
    artists,
    album: album as string | null,
    albumId: albumId as string | null,
    durationMs: durationMs as number | null,
    artworkUrl: artworkUrl as string | null,
    explicit,
  };
};

const readMix = (value: unknown): DiscoverMix | null => {
  if (!isRecord(value) || !isString(value.id) || !isRecord(value.seed)) return null;
  const { kind, name } = value.seed;
  if ((kind !== "artist" && kind !== "song") || !isString(name)) return null;
  if (!Array.isArray(value.songs)) return null;
  const songs = value.songs.flatMap((song) => readSong(song) ?? []);
  return songs.length === 0 ? null : { id: value.id, seed: { kind, name }, songs };
};

/**
 * The mixes [stored] holds, or null when nothing, or nothing readable, is
 * saved. A song or a mix that can't be read is left out.
 */
export const parseDiscoverMixes = (stored: string | null): DiscoverMixes | null => {
  const { builtAt, mixes } = readStoredRecord(stored);
  if (!isNumber(builtAt) || !Array.isArray(mixes)) return null;
  return { builtAt, mixes: mixes.flatMap((mix) => readMix(mix) ?? []) };
};

const localDay = (ms: number): string => new Date(ms).toDateString();

/**
 * Whether to build the mixes again at [now], given when they were last built
 * ([builtAt], null for never): once a day, from the next day on the phone's
 * calendar. Built later than now, the clock went back, so they're built again.
 */
export const discoverMixesDue = (builtAt: number | null, now: number): boolean =>
  builtAt === null || builtAt > now || localDay(builtAt) !== localDay(now);

/** What to search YouTube Music's songs for to find a song seed on it. */
export const discoverSeedQuery = (song: DiscoverSeedSong): string => `${song.title} ${song.artist}`;

/**
 * The video a song seed's radio starts from: the first of [results] (a songs
 * search for `discoverSeedQuery`) that is the song, as a YT Music song is
 * found in the Library (`libraryFinder`), or null when none is.
 */
export const discoverSeedVideo = (
  song: DiscoverSeedSong,
  results: readonly YtSong[],
): string | null => {
  const isSeed = libraryFinder([song]);
  return results.find((result) => isSeed(result) !== null)?.videoId ?? null;
};
