/**
 * Discover mixes (docs/spec.md, "Home"): a Home shelf of mixes made of songs
 * the owner doesn't know yet. Each mix starts from one of the owner's most
 * played artists or songs (or, while plays make too few, one of the
 * Library's) and keeps what YouTube Music's radio for it plays
 * next, less what the Library has and what the owner has played. Core picks
 * the seeds, decides which radio songs a mix keeps and when the mixes are
 * built again; the native module reads the radio and the app saves the mixes.
 */

import { splitCredit } from "./credits.ts";
import { artistPhotoName } from "./artistPhoto.ts";
import { identityKey } from "./library.ts";
import { normalizeSearchText } from "./search.ts";
import { readStoredRecord } from "./storedJson.ts";
import { libraryArtistFinder, ytArtistQuery } from "./ytArtist.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";
import { libraryFinder, type YtSong } from "./ytMusic.ts";

/** How many mixes Home shows at most. */
export const DISCOVER_MIX_COUNT = 6;

/** A Library artist as seeding sees it. */
export interface DiscoverSeedArtist {
  readonly id: number;
  readonly name: string;
}

/** A Library song as seeding sees it. */
export interface DiscoverSeedSong {
  readonly id: number;
  readonly title: string;
  /** Its artist credit. */
  readonly artist: string;
  /** The Library artists its credit names. */
  readonly artistIds: readonly number[];
  readonly durationMs: number;
}

/** A Library artist with how many of the Library's songs credit them. */
export interface DiscoverLibraryArtist extends DiscoverSeedArtist {
  readonly songCount: number;
}

/** A Library song with when it entered the Library (ms since the epoch). */
export interface DiscoverLibrarySong extends DiscoverSeedSong {
  readonly addedAt: number;
}

/**
 * Where a seed comes from: the owner's plays, the Library when plays are
 * short, or artists YouTube Music finds similar to the Library's.
 */
export type DiscoverSeedSource = "plays" | "library" | "similar";

/** An artist YouTube Music lists as similar to a Library artist. */
export interface DiscoverSimilarArtist {
  readonly name: string;
  /** Their YouTube Music page (`UC…`). */
  readonly browseId: string;
}

/** The similar artists a Library artist's YouTube Music page lists ("Fans might also like"). */
export interface DiscoverSimilarArtists {
  /** The Library artist whose page it is (`discoverSimilarSource`). */
  readonly of: string;
  /** In the page's order; none when the page couldn't be read or lists none. */
  readonly artists: readonly DiscoverSimilarArtist[];
}

/** What a mix starts from: an artist, or a song. */
export type DiscoverMixSeed =
  | {
      readonly kind: "artist";
      /** Tells the mix apart from the others, and from itself on another day. */
      readonly id: string;
      readonly name: string;
      readonly from: DiscoverSeedSource;
      /** Their YouTube Music page, for a similar artist: their radio starts there. */
      readonly browseId?: string;
    }
  | {
      readonly kind: "song";
      readonly id: string;
      /** The song's title. */
      readonly name: string;
      readonly from: DiscoverSeedSource;
      readonly song: DiscoverSeedSong;
    };

/** What the seeds are picked from, each source filling what the ones before left short. */
export interface DiscoverSeedPools {
  /** The owner's all-time most played artists and songs, most played first. */
  readonly played: {
    readonly artists: readonly DiscoverSeedArtist[];
    readonly songs: readonly DiscoverSeedSong[];
  };
  /** The Library's artists and songs, in any order. */
  readonly library?: {
    readonly artists: readonly DiscoverLibraryArtist[];
    readonly songs: readonly DiscoverLibrarySong[];
  };
  /**
   * The similar artists read so far, page by page, in the order
   * `discoverSimilarSource` asked for them. Used with [library] only.
   */
  readonly similar?: readonly DiscoverSimilarArtists[];
}

/** How many of the mixes start from artists when there are songs enough for the rest. */
const ARTIST_SEEDS = 3;
/** How many of the Library's artists with the most songs seeding looks at. */
const LIBRARY_ARTISTS = 20;
/** How many Library artists' pages are read for similar artists at most. */
const SIMILAR_PAGES = 3;

const songKey = (song: DiscoverSeedSong): string =>
  `${normalizeSearchText(song.title)}\u001f${normalizeSearchText(song.artist)}`;

/** A seed artist: a Library artist, or a similar one with their page. */
interface SeedArtist extends DiscoverSeedArtist {
  readonly browseId?: string;
}

/** Artists and songs, in the order seeding takes them: a source's, or the seeds picked. */
interface SeedPool {
  readonly artists: readonly SeedArtist[];
  readonly songs: readonly DiscoverSeedSong[];
}

/**
 * Up to [want] seeds from [pool] beside the seeds [taken] from the sources
 * before: [target] artists and songs for the rest, each song by none of the
 * seed artists, each artist on none of the seed songs, each artist and each
 * recording once. Short of [want], one artist more at a time makes it up, as
 * each may take songs crediting them out of the rest, the pool's own artists
 * first and then the [similar] ones (vetted already); short with every
 * artist, one fewer of the pool's own at a time, the similar ones staying
 * (they take no songs); still short, the most seeds found.
 */
const pickSeeds = (
  pool: SeedPool,
  taken: SeedPool,
  want: number,
  target: number,
  similar: readonly SeedArtist[] = [],
): SeedPool => {
  const seen = new Set(taken.artists.map((artist) => identityKey(artist.name)));
  const credited = new Set(taken.songs.flatMap((song) => song.artistIds));
  const named = pool.artists.filter((artist) => {
    if (ytArtistQuery(artist.name) === null || credited.has(artist.id)) return false;
    const key = identityKey(artist.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const seededRecordings = taken.songs.map(songKey);
  const candidates = [...named, ...similar];
  const seedsWith = (artists: readonly SeedArtist[]) => {
    const by = new Set([...taken.artists, ...artists].map((artist) => artist.id));
    const recordings = new Set(seededRecordings);
    const songs: DiscoverSeedSong[] = [];
    for (const song of pool.songs) {
      if (artists.length + songs.length >= want) break;
      if (song.artistIds.some((id) => by.has(id))) continue;
      const key = songKey(song);
      if (recordings.has(key)) continue;
      recordings.add(key);
      songs.push(song);
    }
    return { artists, songs, count: artists.length + songs.length };
  };
  const most = Math.min(candidates.length, want);
  const start = Math.min(target, most);
  let best = seedsWith(candidates.slice(0, start));
  for (let count = start + 1; best.count < want && count <= most; count++) {
    const more = seedsWith(candidates.slice(0, count));
    if (more.count > best.count) best = more;
  }
  // Similar artists take no songs from the rest, so only the pool's own make way.
  const similarKept = best.artists.slice(named.length);
  for (let count = Math.min(start, named.length) - 1; best.count < want && count >= 0; count--) {
    const fewer = seedsWith([...named.slice(0, count), ...similarKept]);
    if (fewer.count > best.count) best = fewer;
  }
  return best;
};

const artistSeed = (artist: SeedArtist, from: DiscoverSeedSource): DiscoverMixSeed => ({
  kind: "artist",
  id: `artist:${identityKey(artist.name)}`,
  name: artist.name,
  from,
  ...(artist.browseId === undefined ? {} : { browseId: artist.browseId }),
});

/**
 * [picked] as seeds from [from], artists and songs taking turns from the
 * first artist, then its similar artists (the ones with a page).
 */
const seedsOf = (picked: SeedPool, from: DiscoverSeedSource): DiscoverMixSeed[] => {
  const own = picked.artists.filter((artist) => artist.browseId === undefined);
  const seeds: DiscoverMixSeed[] = [];
  for (let turn = 0; turn < Math.max(own.length, picked.songs.length); turn++) {
    const artist = own[turn];
    if (artist !== undefined) seeds.push(artistSeed(artist, from));
    const song = picked.songs[turn];
    if (song !== undefined)
      seeds.push({ kind: "song", id: `song:${song.id}`, name: song.title, from, song });
  }
  for (const artist of picked.artists)
    if (artist.browseId !== undefined) seeds.push(artistSeed(artist, "similar"));
  return seeds;
};

/**
 * The similar artists of [similar] that may seed, in order: the pages take
 * turns, each giving its next artist that the Library ([known]) doesn't
 * have, whose name is an artist's and that no page gave before (by name or
 * by page). Each gets an id no Library artist has.
 */
const similarPool = (
  similar: readonly DiscoverSimilarArtists[],
  known: readonly DiscoverSeedArtist[],
): SeedArtist[] => {
  const inLibrary = libraryArtistFinder(known);
  const names = new Set<string>();
  const pages = new Set<string>();
  const usable = ({ name, browseId }: DiscoverSimilarArtist): boolean => {
    if (ytArtistQuery(name) === null || inLibrary(name) !== null) return false;
    const key = artistPhotoName(name);
    if (names.has(key) || pages.has(browseId)) return false;
    names.add(key);
    pages.add(browseId);
    return true;
  };
  const next = similar.map(() => 0);
  const pool: SeedArtist[] = [];
  for (let more = true; more;) {
    more = false;
    similar.forEach(({ artists }, page) => {
      for (let at = next[page] ?? artists.length; at < artists.length; at++) {
        const artist = artists[at];
        if (artist === undefined || !usable(artist)) continue;
        next[page] = at + 1;
        pool.push({ id: -(pool.length + 1), name: artist.name, browseId: artist.browseId });
        more = true;
        return;
      }
      next[page] = artists.length;
    });
  }
  return pool;
};

/** The Library as seeding takes it: its artists with the most songs, then its newest songs. */
const libraryPool = (library: NonNullable<DiscoverSeedPools["library"]>): SeedPool => ({
  artists: [...library.artists].sort((a, b) => b.songCount - a.songCount).slice(0, LIBRARY_ARTISTS),
  songs: [...library.songs].sort((a, b) => b.addedAt - a.addedAt),
});

/**
 * The mixes' seeds, six at most. First the owner's most played artists and
 * songs: three artists and three songs, taking turns from the most played
 * artist, a song by none of the artists seeding a mix (their mix has it
 * already); with too few of either, the other makes up the six. When plays
 * make fewer, the Library fills the rest after them under the same rules,
 * with its artists with the most songs and its newest songs. When its
 * artists are too few for that, artists similar to the Library's
 * ([similar]) come after its own: ones the Library doesn't have, the pages
 * taking turns. Names that aren't an artist's ("Various Artists") seed
 * nothing.
 */
export const discoverMixSeeds = (pools: DiscoverSeedPools): DiscoverMixSeed[] =>
  seedsFrom(pools, similarOf(pools));

/**
 * The Library artist whose YouTube Music page to read next for similar
 * artists (to add to `DiscoverSeedPools.similar`), or null when the seeds
 * have no room left for them or three pages have been read. The owner's most
 * played artists come first, then the Library's with the most songs. A page
 * that couldn't be read counts as read, with no artists.
 */
export const discoverSimilarSource = (pools: DiscoverSeedPools): DiscoverSeedArtist | null => {
  const { played, library, similar = [] } = pools;
  if (library === undefined || similar.length >= SIMILAR_PAGES) return null;
  const known = similarOf(pools);
  // As many stand-ins as there are mixes: seeds that take one have room for more.
  const standIns = Array.from({ length: DISCOVER_MIX_COUNT }, (_, at) => ({
    id: -(known.length + at + 1),
    name: "",
    browseId: "",
  }));
  const seeds = seedsFrom(pools, [...known, ...standIns]);
  if (seeds.filter((seed) => seed.from === "similar").length <= known.length) return null;
  const read = new Set(similar.map((page) => identityKey(page.of)));
  for (const { id, name } of [...played.artists, ...libraryPool(library).artists]) {
    if (ytArtistQuery(name) === null || read.has(identityKey(name))) continue;
    return { id, name };
  }
  return null;
};

/** The similar artists of [pools] that may seed (`similarPool`). */
const similarOf = ({ played, library, similar = [] }: DiscoverSeedPools): SeedArtist[] =>
  library === undefined ? [] : similarPool(similar, [...played.artists, ...library.artists]);

/** The seeds from [pools], with [similar] (vetted, in order) after the Library's artists. */
const seedsFrom = (
  { played, library }: DiscoverSeedPools,
  similar: readonly SeedArtist[],
): DiscoverMixSeed[] => {
  const sources: [DiscoverSeedSource, SeedPool, readonly SeedArtist[]][] = [["plays", played, []]];
  if (library !== undefined) sources.push(["library", libraryPool(library), similar]);
  const seeds: DiscoverMixSeed[] = [];
  let taken: SeedPool = { artists: [], songs: [] };
  for (const [from, pool, extra] of sources) {
    const want = DISCOVER_MIX_COUNT - seeds.length;
    if (want === 0) break;
    const target = Math.max(0, ARTIST_SEEDS - taken.artists.length);
    const picked = pickSeeds(pool, taken, want, target, extra);
    seeds.push(...seedsOf(picked, from));
    taken = {
      artists: [...taken.artists, ...picked.artists],
      songs: [...taken.songs, ...picked.songs],
    };
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
  /** Whether any of the build's seeds came from plays (not every seed makes a mix). */
  readonly playSeeds: boolean;
  readonly mixes: readonly DiscoverMix[];
}

const built = (
  mixes: readonly DiscoverMix[],
  builtAt: number,
  playSeeds: boolean,
): DiscoverMixes | null => (mixes.length === 0 ? null : { builtAt, playSeeds, mixes });

/**
 * What a build from [seeds] that made [mixes] saves. Only a build with usable
 * mixes replaces the cache and starts a new daily interval.
 */
export const discoverMixesBuilt = (
  mixes: readonly DiscoverMix[],
  builtAt: number,
  seeds: readonly DiscoverMixSeed[],
): DiscoverMixes | null =>
  built(
    mixes,
    builtAt,
    seeds.some((seed) => seed.from === "plays"),
  );

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
 * saved. A song or a mix that can't be read is left out. Mixes saved before
 * seeds could come from the Library were built from plays.
 */
export const parseDiscoverMixes = (stored: string | null): DiscoverMixes | null => {
  const { builtAt, playSeeds, mixes } = readStoredRecord(stored);
  if (!isNumber(builtAt) || !Array.isArray(mixes)) return null;
  return built(
    mixes.flatMap((mix) => readMix(mix) ?? []),
    builtAt,
    playSeeds !== false,
  );
};

const localDay = (ms: number): string => new Date(ms).toDateString();

/**
 * Whether to build the mixes again at [now], given the last build ([last],
 * null for never) and whether the owner has [played] anything (counted plays):
 * once a day, from the next day on the phone's calendar, and as soon as there
 * are plays when the last build had no seeds from plays. Built later than
 * now, the clock went back, so they're built again.
 */
export const discoverMixesDue = (
  last: Pick<DiscoverMixes, "builtAt" | "playSeeds"> | null,
  { now, played }: { readonly now: number; readonly played: boolean },
): boolean =>
  last === null ||
  last.builtAt > now ||
  localDay(last.builtAt) !== localDay(now) ||
  (played && !last.playSeeds);

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
