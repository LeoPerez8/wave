/**
 * Home's mixes (docs/spec.md, "Artist mixes"): mixes made of songs the owner
 * doesn't know yet. Each mix starts from a seed (an artist, picked by
 * `artistMixSeeds`) and keeps what YouTube Music's radio for it plays next,
 * less what the Library has and what the owner has played. Core decides
 * which radio songs a mix keeps and when the mixes are built again; the
 * native module reads the radio and the app saves the mixes.
 */

import { splitCredit } from "./credits.ts";
import type { BlendedDiscoverMix, DiscoverMixSong } from "./discoverMixLevels.ts";
import type { ExplicitFlag } from "./explicit.ts";
import type { HomeSectionId } from "./homeSections.ts";
import { identityKey } from "./library.ts";
import { normalizeSearchText } from "./search.ts";
import { readStoredRecord } from "./storedJson.ts";
import type { MixedSong, YtAlbumSong } from "./ytDiscover.ts";
import type { YtSong } from "./ytMusic.ts";

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
  /** Its explicit flag, for a mix's Library pool (Don't play explicit); absent counts as unknown. */
  readonly explicit?: ExplicitFlag;
  /** Its cached artwork file, for a mix's tile; null or absent for none. */
  readonly artworkPath?: string | null;
}

/** A Library artist with how many of the Library's songs credit them. */
export interface DiscoverLibraryArtist extends DiscoverSeedArtist {
  readonly songCount: number;
}

/** A Library song with when it entered the Library (ms since the epoch). */
export interface DiscoverLibrarySong extends DiscoverSeedSong {
  readonly addedAt: number;
  /** Its genre tag (the file's, or what Fix Song wrote); null or absent for none. */
  readonly genre?: string | null;
  /**
   * Every value of a multi-value genre tag (Vorbis comments, ID3v2.4), where
   * [genre] is the first; absent for a single one. Only Genre mixes read them.
   */
  readonly genres?: readonly string[] | null;
}

/** A Library song's all-time counted plays. */
export interface DiscoverSongPlays {
  /** The song's id (`DiscoverSeedSong.id`). */
  readonly id: number;
  readonly countedPlays: number;
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
  /** The Library artist whose page it is (`artistMixSimilarSource`). */
  readonly of: string;
  /** In the page's order; none when the page couldn't be read or lists none. */
  readonly artists: readonly DiscoverSimilarArtist[];
}

/**
 * What a mix starts from: an artist (`artistMixSeeds`), or a genre family
 * and up to three of its artists, whose radios are interleaved
 * (`genreMixSeeds`).
 */
export interface DiscoverMixSeed {
  readonly kind: "artist" | "genre";
  /** Tells the mix apart from the others, and from itself on another day. */
  readonly id: string;
  /** The artist's name, or the genre family's ("Metal"). */
  readonly name: string;
  readonly from: DiscoverSeedSource;
  /** Their YouTube Music page, for a similar artist: their radio starts there. */
  readonly browseId?: string;
  /** The genre family the mix stands for (Core's `genreFamily` name); absent for an artist's mix. */
  readonly genre?: string;
  /**
   * A genre mix's seed artists, whose radios it grows from, in the radios'
   * turn order; its familiar share takes their non-D songs. Absent: [name].
   */
  readonly artists?: readonly DiscoverSeedArtist[];
}

/** The artists whose radios [seed]'s mix grows from: a genre mix's seed artists, an artist mix's artist. */
export const mixSeedArtists = (
  seed: DiscoverMixSeed,
): readonly Pick<DiscoverMixSeed, "name" | "browseId">[] => seed.artists ?? [seed];

const GENRE_MIX_ID = "genre:";

/** A genre mix's id (`DiscoverMixSeed.id`), from its family's key (`genreFamily`). */
export const genreMixId = (familyKey: string): string => `${GENRE_MIX_ID}${familyKey}`;

/** The Home section a mix (by its seed's [id]) is of: Genre mixes' or Artist mixes'. */
export const mixSectionOfId = (
  id: string,
): Extract<HomeSectionId, "artist-mixes" | "genre-mixes"> =>
  id.startsWith(GENRE_MIX_ID) ? "genre-mixes" : "artist-mixes";

const FIELD = "\u001f";

/**
 * What tells a radio song's recording apart within mixes: its title and
 * artists, compared as Search compares text.
 */
export const mixRecordingOf = (song: Pick<YtSong, "title" | "artists">): string =>
  `${normalizeSearchText(song.title)}${FIELD}${song.artists.map(normalizeSearchText).join(FIELD)}`;
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
  /**
   * Whether the owner knows the song (`mixKnownSongs`): the Library has it,
   * it was played or streamed, or a playlist has it.
   */
  readonly known: (song: S) => boolean;
  /** The songs the mixes before this one have, by video id. */
  readonly taken: ReadonlySet<string>;
  /**
   * For a refresh: the new songs of the sets the section showed today
   * (`mixRefreshAvoid`), by video id. They come back only to make up a mix's
   * fewest songs, in the radio's order.
   */
  readonly avoid?: ReadonlySet<string>;
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
 * songs the owner knows (the Library's, played, streamed or in a playlist),
 * songs an earlier mix has and a song the radio plays again are left out;
 * 50 at most. Reading a page at a time, pass the songs kept from the pages before as [before]:
 * they come first, and only the new pages' songs are looked at.
 */
export const discoverMixSongs = <S extends DiscoverRadioSong>(
  pages: readonly (readonly S[])[],
  filter: DiscoverMixFilter<S>,
  before: readonly S[] = [],
): S[] => {
  const videos = new Set(filter.taken);
  for (const song of before) videos.add(song.videoId);
  const recordings = new Set(before.map(mixRecordingOf));
  const kept: S[] = [...before];
  // Songs a refresh avoids, kept back in case the mix is short without them.
  const held: S[] = [];
  const radio = pages.flat();
  for (const song of radio) {
    if (kept.length >= MIX_MOST) break;
    const recording = mixRecordingOf(song);
    if (song.video || videos.has(song.videoId) || recordings.has(recording)) continue;
    if (filter.known(song)) continue;
    videos.add(song.videoId);
    recordings.add(recording);
    if (filter.avoid?.has(song.videoId) === true) held.push(song);
    else kept.push(song);
  }
  if (kept.length >= MIX_FEWEST || held.length === 0) return kept;
  const back = new Set(held.slice(0, MIX_FEWEST - kept.length));
  const fromPages = new Set(kept.slice(before.length));
  return [...before, ...radio.filter((song) => fromPages.has(song) || back.has(song))];
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
export const MIX_FEWEST = 10;

/** One of the mixes, as Home shows it and its page lists it. */
export interface DiscoverMix {
  /** Its seed's id (`DiscoverMixSeed`): the page's address. */
  readonly id: string;
  readonly seed: {
    readonly kind: DiscoverMixSeed["kind"];
    readonly name: string;
    /** The Library genre the mix stands for (`DiscoverMixSeed.genre`); absent for the others. */
    readonly genre?: string;
    /**
     * The seed's artists: an artist mix's artist, a genre mix's seed
     * artists. Absent on mixes saved before they were kept.
     */
    readonly artists?: readonly string[];
  };
  /**
   * Its new songs, in the radio's order: the whole mix at level 5. What plays
   * at the owner's level is `blendDiscoverMix`'s.
   */
  readonly songs: readonly YtAlbumSong[];
  /**
   * The songs its familiar share takes, in the order it takes them
   * (`discoverMixFamiliarPool`): Library songs, and songs the owner knows
   * that the phone has no file for, which stream. Absent: it plays its new
   * songs alone.
   */
  readonly familiar?: readonly DiscoverMixFamiliarSong[];
}

/** A song of a mix's familiar share: one of the Library's, or one the owner knows that streams. */
export type DiscoverMixFamiliarSong = MixedSong<YtAlbumSong, DiscoverMixLibrarySong>;

/** A Library song a mix may play as one of its familiar songs. */
export interface DiscoverMixLibrarySong {
  /** Its Library track id. */
  readonly id: number;
  readonly title: string;
  /** Its artist credit. */
  readonly artist: string;
  /**
   * Its explicit flag as the build saw it, so Home leaves it out while Don't
   * play explicit is on without reading the Library; absent for unknown.
   */
  readonly explicit?: ExplicitFlag;
  /**
   * Its cached artwork file as the build saw it, for the mix's tile when the
   * level leans familiar (`discoverMixCaption`); absent for none.
   */
  readonly artworkPath?: string;
}

/**
 * A pool song as a mix saves it: [song]'s id, title, credit, and its
 * explicit flag and artwork file when it has them.
 */
export const mixLibrarySong = ({
  id,
  title,
  artist,
  explicit,
  artworkPath,
}: DiscoverSeedSong | DiscoverMixLibrarySong): DiscoverMixLibrarySong => ({
  id,
  title,
  artist,
  ...(explicit === undefined || explicit === "unknown" ? {} : { explicit }),
  ...(artworkPath === undefined || artworkPath === null || artworkPath === ""
    ? {}
    : { artworkPath }),
});

/**
 * The mix [seed] makes of [songs] (`discoverMixSongs`) and its [familiar]
 * share (`discoverMixFamiliarPool`), or null when its new songs are fewer
 * than ten: too few to be a mix.
 */
export const discoverMix = (
  seed: DiscoverMixSeed,
  songs: readonly (DiscoverRadioSong & { readonly albumId: string | null })[],
  familiar: readonly DiscoverMixFamiliarSong[] = [],
): DiscoverMix | null =>
  songs.length < MIX_FEWEST
    ? null
    : {
        id: seed.id,
        seed: {
          kind: seed.kind,
          name: seed.name,
          ...(seed.genre === undefined ? {} : { genre: seed.genre }),
          artists: mixSeedArtists(seed).map((artist) => artist.name),
        },
        songs: songs.map(({ video: _video, ...song }) => song),
        familiar: familiar.map((song): DiscoverMixFamiliarSong =>
          song.source === "stream"
            ? song
            : { source: "library", track: mixLibrarySong(song.track) },
        ),
      };

/** How many of a mix's artists its tile names. */
const CAPTION_ARTISTS = 3;

/**
 * A mix's tile on Home, as the owner's level blends it (`blendDiscoverMix`):
 * named after its seed, over the first three artists it plays (each song's
 * lead artist, the familiar songs' too), with how many songs it has, under
 * the cover of the first song of the share it mostly plays: its first
 * familiar song's (a Library song's, or one that streams) when familiar
 * songs outnumber new ones (20% and 40% new), else its
 * first new song's. A song without a cover passes to the next of that share,
 * then to the mix's first song with one. So changing the level changes the
 * tile. [artworkUrl] is an address the image loads from: YouTube Music's, or
 * a Library song's cached artwork file as a `file://` URI. A genre's mix is
 * named after the genre, its seed's lead artist first among the three.
 */
export const discoverMixCaption = (
  mix: BlendedDiscoverMix,
): {
  readonly title: string;
  readonly artists: string;
  readonly line: string;
  readonly artworkUrl: string | null;
} => {
  const { genre } = mix.seed;
  const artists = new Map<string, string>();
  const seedArtist = mix.seed.artists?.[0];
  if (genre !== undefined && seedArtist !== undefined)
    artists.set(identityKey(seedArtist), seedArtist);
  for (const song of mix.songs) {
    if (artists.size === CAPTION_ARTISTS) break;
    const lead =
      song.source === "stream" ? song.song.artists[0] : splitCredit(song.track.artist)[0];
    if (lead === undefined) continue;
    const key = identityKey(lead);
    if (!artists.has(key)) artists.set(key, lead);
  }
  const name = genre === undefined ? mix.seed.name : genreTitle(genre);
  return {
    title: `${name} mix`,
    artists: [...artists.values()].join(", "),
    line: `${mix.songs.length} songs`,
    artworkUrl: mixCover(mix),
  };
};

/** Where [song]'s cover loads from, or null when it has none. */
const coverOf = (song: DiscoverMixSong): string | null => {
  if (song.source === "stream") return song.song.artworkUrl;
  const path = song.track.artworkPath;
  return path === undefined ? null : `file://${path}`;
};

/** The covers [songs] have, in order. */
const coversOf = (songs: readonly DiscoverMixSong[]): string[] =>
  songs.flatMap((song) => coverOf(song) ?? []);

/** Whether [song] is of a mix's familiar share: a Library song, or a familiar one that streams. */
const isFamiliar = (song: DiscoverMixSong): boolean =>
  song.source === "library" || song.familiar === true;

/** The cover of the first song of the share [mix] mostly plays (`discoverMixCaption`). */
const mixCover = (mix: BlendedDiscoverMix): string | null => {
  const familiar = mix.songs.filter(isFamiliar).length;
  const leansFamiliar = familiar > mix.songs.length - familiar;
  return (
    coversOf(mix.songs.filter((song) => isFamiliar(song) === leansFamiliar))[0] ??
    coversOf(mix.songs)[0] ??
    null
  );
};

/** The mixes as last built, saved so Home shows them without waiting on YouTube Music. */
export interface DiscoverMixes {
  /** When they were built (ms since the epoch). */
  readonly builtAt: number;
  /** Whether any of the build's seeds came from plays (not every seed makes a mix). */
  readonly playSeeds: boolean;
  readonly mixes: readonly DiscoverMix[];
}

/** A genre as a mix's title names it: one typed all in lowercase gets capital initials. */
const genreTitle = (genre: string): string =>
  genre === genre.toLowerCase()
    ? genre.replace(
        /(^|[\s-])(\p{L})/gu,
        (_, before: string, letter: string) => before + letter.toUpperCase(),
      )
    : genre;

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

/**
 * The saved mixes' format. 2: Artist mixes (#420). 3: familiar shares that
 * stream songs the owner knows (#428). Mixes saved in an older one read as
 * none, so the next Home visit builds new ones.
 */
const MIXES_VERSION = 3;

/** What to save for [mixes]. */
export const storedDiscoverMixes = (mixes: DiscoverMixes): string =>
  JSON.stringify({ version: MIXES_VERSION, ...mixes });

const isString = (value: unknown): value is string => typeof value === "string";
const isNullable = <T>(value: unknown, is: (value: unknown) => value is T): boolean =>
  value === null || is(value);
export const isNumber = (value: unknown): value is number =>
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
  const { kind, name, genre, artists } = value.seed;
  if ((kind !== "artist" && kind !== "genre") || !isString(name)) return null;
  if (!Array.isArray(value.songs)) return null;
  const songs = value.songs.flatMap((song) => readSong(song) ?? []);
  const seed: DiscoverMix["seed"] = {
    kind,
    name,
    ...(isString(genre) && genre !== "" ? { genre } : {}),
    ...(Array.isArray(artists) && artists.every(isString) ? { artists } : {}),
  };
  if (songs.length === 0) return null;
  if (!Array.isArray(value.familiar)) return { id: value.id, seed, songs };
  return { id: value.id, seed, songs, familiar: value.familiar.flatMap(readFamiliarSong) };
};

const readFamiliarSong = (value: unknown): DiscoverMixFamiliarSong[] => {
  if (!isRecord(value)) return [];
  if (value.source === "stream") {
    const song = readSong(value.song);
    return song === null ? [] : [{ source: "stream", song }];
  }
  if (value.source !== "library" || !isRecord(value.track)) return [];
  const { id, title, artist, explicit, artworkPath } = value.track;
  if (!isNumber(id) || !isString(title) || !isString(artist)) return [];
  return [
    {
      source: "library",
      track: mixLibrarySong({
        id,
        title,
        artist,
        ...(explicit === "explicit" || explicit === "clean" ? { explicit } : {}),
        ...(isString(artworkPath) ? { artworkPath } : {}),
      }),
    },
  ];
};

/**
 * The mixes [stored] holds, or null when nothing, or nothing readable, is
 * saved, or they were saved in an older format (`MIXES_VERSION`). A song or
 * a mix that can't be read is left out.
 */
export const parseDiscoverMixes = (stored: string | null): DiscoverMixes | null => {
  const { version, builtAt, playSeeds, mixes } = readStoredRecord(stored);
  if (version !== MIXES_VERSION || !isNumber(builtAt) || !Array.isArray(mixes)) return null;
  return built(
    mixes.flatMap((mix) => readMix(mix) ?? []),
    builtAt,
    playSeeds === true,
  );
};

/** [ms]'s day on the phone's calendar, to tell days apart. */
export const localDay = (ms: number): string => new Date(ms).toDateString();

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
