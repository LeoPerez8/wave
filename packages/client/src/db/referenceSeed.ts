/**
 * A Library the size of the reference phone's, for emulator measurements
 * (`scripts/perf/seed.ts`). Every name is generated: nothing in it is anyone's data.
 *
 * The catalogue is the tags the seed's files hold. The database is written
 * from those same tags, through the scanner's own conversion (`scannedTrack`)
 * and the store's writes, so a scan of the files finds the songs it already
 * holds instead of adding them again.
 */
import {
  explicitFromAdvisory,
  gainTags,
  isrcFromTag,
  normalizeTrack,
  ytTrackId,
  type PlayEvent,
  type PlaylistSong,
  type YtAlbumSong,
} from "@wave/core";

import { migrateDatabase } from "../database.ts";
import type { IndexedTrack } from "../types.ts";
import { creditSplits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import { saveFollow } from "./follows.ts";
import { ensureDefaultRoot, linkEntries, markScanned } from "./libraryQueries.ts";
import migrations from "./migrations.ts";
import { noteStreamedSong } from "./mixKnown.ts";
import { endPlay, recordPlay, setFavorites } from "./playHistory.ts";
import { createPlaylist } from "./playlists.ts";
import { saveBatch } from "./save.ts";
import * as schema from "./schema.ts";
import { openSqlJsDatabase } from "./sqlJsDatabase.ts";

/** How much the seed holds. */
export interface ReferenceSize {
  readonly songs: number;
  readonly artists: number;
  readonly albums: number;
  readonly playlists: number;
  /** Entries across every playlist, Library songs and YT Music songs. */
  readonly playlistEntries: number;
  /** Distinct YouTube videos the Library knows (`selectKnownVideos`). */
  readonly knownVideos: number;
  /** Recorded plays over the last year, some of them streamed. */
  readonly plays: number;
  readonly follows: number;
  readonly favorites: number;
}

/** The reference phone's Library (#1432). */
export const REFERENCE_SIZE: ReferenceSize = {
  songs: 3_000,
  artists: 900,
  albums: 1_500,
  playlists: 60,
  playlistEntries: 26_700,
  knownVideos: 20_500,
  plays: 12_000,
  follows: 5,
  favorites: 150,
};

/** MPEG-1 Layer III at 44.1 kHz: samples in a frame, and the rate. */
const FRAME_SAMPLES = 1_152;
const SAMPLE_RATE = 44_100;
export const SEED_BITRATE_KBPS = 32;

/** A song's file and the tags it holds. */
export interface SeedSong {
  /** Its path under the seed's folder: `Artist/Album/01 Title.mp3`. */
  readonly file: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly genre: string;
  readonly year: number;
  readonly trackNumber: number;
  /** MPEG frames its audio claims (the Xing header's count): what its length is read from. */
  readonly frames: number;
  readonly durationMs: number;
}

export interface SeedPlaylist {
  readonly name: string;
  /** Library songs (catalogue indexes) and YT Music songs (stream video indexes), in order. */
  readonly entries: readonly SeedEntry[];
}

export type SeedEntry =
  | { readonly source: "library"; readonly song: number }
  | { readonly source: "stream"; readonly video: number };

export interface SeedPlay {
  readonly startedAt: number;
  readonly listenedMs: number;
  readonly completed: boolean;
  readonly target: SeedEntry;
}

export interface ReferenceCatalogue {
  readonly size: ReferenceSize;
  readonly songs: readonly SeedSong[];
  /** YT Music songs: playlist entries, streamed plays and the videos only known. */
  readonly videos: readonly YtAlbumSong[];
  readonly playlists: readonly SeedPlaylist[];
  /** Plays as offsets before the seed's time, oldest first. */
  readonly plays: readonly SeedPlay[];
  /** Videos known only as songs streamed once (`noteStreamedSong`). */
  readonly notedVideos: readonly number[];
  readonly favorites: readonly number[];
  readonly follows: readonly string[];
}

/** A small deterministic generator (mulberry32), so every seed is the same. */
const random = (seed: number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const FIRST = [
  "Amber",
  "Arlo",
  "Bastion",
  "Briar",
  "Cobalt",
  "Coral",
  "Dune",
  "Ember",
  "Fable",
  "Fennel",
  "Gale",
  "Garnet",
  "Harbor",
  "Hollow",
  "Indigo",
  "Juniper",
  "Kestrel",
  "Lark",
  "Linden",
  "Marlow",
  "Meadow",
  "Nova",
  "Oberon",
  "Onyx",
  "Pike",
  "Quill",
  "Raven",
  "Sable",
  "Tamsin",
  "Umber",
] as const;
const LAST = [
  "Ashby",
  "Barrow",
  "Carver",
  "Dalton",
  "Easton",
  "Fairley",
  "Granger",
  "Hale",
  "Ingram",
  "Jarvis",
  "Kemble",
  "Lowell",
  "Mercer",
  "Norwood",
  "Oakes",
  "Pembroke",
  "Quarry",
  "Rowan",
  "Sterling",
  "Thorne",
  "Underhill",
  "Vance",
  "Whitlock",
  "Yardley",
  "Zeller",
  "Ainsley",
  "Brook",
  "Calloway",
  "Dorsey",
  "Ellery",
  "Fenwick",
  "Gilmore",
  "Hartley",
  "Irving",
  "Keats",
  "Langley",
  "Morrow",
  "Nolan",
  "Pryor",
  "Radley",
] as const;
const ADJECTIVES = [
  "Silver",
  "Quiet",
  "Golden",
  "Hidden",
  "Distant",
  "Velvet",
  "Electric",
  "Paper",
  "Crimson",
  "Northern",
  "Broken",
  "Endless",
  "Gentle",
  "Hollow",
  "Lucid",
  "Midnight",
  "Neon",
  "Open",
  "Pale",
  "Restless",
  "Salt",
  "Tidal",
  "Upper",
  "Wild",
  "Young",
  "Amber",
  "Bright",
  "Cold",
  "Dusty",
  "Faded",
  "Glass",
  "Heavy",
  "Iron",
  "Late",
  "Little",
  "Modern",
  "Lunar",
  "Rapid",
  "Second",
  "Summer",
] as const;
const NOUNS = [
  "Rivers",
  "Lights",
  "Fields",
  "Signals",
  "Mornings",
  "Shores",
  "Echoes",
  "Gardens",
  "Windows",
  "Engines",
  "Harbors",
  "Islands",
  "Letters",
  "Mirrors",
  "Orbits",
  "Patterns",
  "Rooms",
  "Seasons",
  "Streets",
  "Towers",
  "Valleys",
  "Waves",
  "Wires",
  "Years",
  "Bridges",
  "Canyons",
  "Dreams",
  "Embers",
  "Forests",
  "Horizons",
  "Lanterns",
  "Maps",
  "Nights",
  "Oceans",
  "Pilots",
  "Roads",
  "Stations",
  "Tides",
  "Voices",
  "Winters",
] as const;
const VERBS = [
  "Falling",
  "Running",
  "Waiting",
  "Burning",
  "Drifting",
  "Holding",
  "Leaving",
  "Calling",
  "Turning",
  "Breathing",
  "Dancing",
  "Fading",
  "Rising",
  "Singing",
  "Sleeping",
  "Walking",
  "Chasing",
  "Climbing",
  "Floating",
  "Shining",
] as const;
const PLACES = [
  "Home",
  "Again",
  "Tonight",
  "Slowly",
  "Away",
  "Together",
  "Alone",
  "Forever",
  "Outside",
  "Upstairs",
  "Downtown",
  "Somewhere",
  "Under Water",
  "In Blue",
  "At Dawn",
  "On Fire",
] as const;
const YT_FIRST = [
  "Kiro",
  "Lumi",
  "Tavi",
  "Rion",
  "Sela",
  "Mako",
  "Nilo",
  "Vesa",
  "Joba",
  "Pira",
  "Dario",
  "Esme",
  "Faro",
  "Gisa",
  "Hobi",
  "Ivo",
  "Kaia",
  "Lono",
  "Mira",
  "Nuri",
] as const;
const YT_LAST = [
  "Vale",
  "Strand",
  "Okoro",
  "Lund",
  "Marsh",
  "Reyes",
  "Tamura",
  "Weld",
  "Quist",
  "Brandt",
  "Castell",
  "Duarte",
  "Elling",
  "Frey",
  "Gallo",
  "Holt",
  "Ilves",
  "Jansen",
  "Kovac",
  "Lorne",
] as const;
const GENRES = [
  "Rock",
  "Pop",
  "Electronic",
  "Jazz",
  "Hip Hop",
  "Folk",
  "Soul",
  "Ambient",
  "Indie",
  "Classical",
  "Blues",
  "Reggae",
] as const;
const PLAYLIST_WORDS = [
  "Archive",
  "Backroads",
  "Commute",
  "Daybreak",
  "Evening",
  "Focus",
  "Gym",
  "Harvest",
  "Kitchen",
  "Late Night",
  "Morning",
  "Night Drive",
  "Rainy Day",
  "Road Trip",
  "Sunday",
  "Workout",
] as const;

/** The [i]th combination of [lists], unique while [i] is under their product. */
const combination = (i: number, ...lists: readonly (readonly string[])[]): string => {
  let rest = i;
  const words = lists.map((list) => {
    const word = list[rest % list.length]!;
    rest = Math.floor(rest / list.length);
    return word;
  });
  return rest === 0 ? words.join(" ") : `${words.join(" ")} ${rest + 1}`;
};

/** An 11-character video id, unique per [i], that looks like YouTube's. */
const videoId = (i: number, next: () => number): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let id = "";
  for (let k = 0; k < 6; k += 1) id += alphabet[Math.floor(next() * 64)];
  let rest = i;
  for (let k = 0; k < 5; k += 1) {
    id += alphabet[rest % 64];
    rest = Math.floor(rest / 64);
  }
  return id;
};

/** [total] split across [weights] in whole numbers that add up to it. */
const apportion = (total: number, weights: readonly number[]): number[] => {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((weight) => (total * weight) / sum);
  const shares = exact.map(Math.floor);
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  const missing = total - shares.reduce((a, b) => a + b, 0);
  for (let k = 0; k < missing; k += 1) shares[order[k % order.length]!.index]! += 1;
  return shares;
};

const DAY_MS = 86_400_000;

/** The seed's songs, playlists, plays and the rest, the same for the same [size]. */
export const referenceCatalogue = (size: ReferenceSize = REFERENCE_SIZE): ReferenceCatalogue => {
  if (size.artists < 1 || size.albums < size.artists || size.songs < size.albums)
    throw new Error("A seed needs 1 ≤ artists ≤ albums ≤ songs");
  const next = random(1432);
  const artists = Array.from({ length: size.artists }, (_, i) => combination(i, FIRST, LAST));
  const albums = Array.from({ length: size.albums }, (_, i) => ({
    title: combination(i, ADJECTIVES, NOUNS),
    artist: artists[i % size.artists]!,
    year: 1965 + Math.floor(next() * 60),
    genre: GENRES[Math.floor(next() * GENRES.length)]!,
  }));
  const songs = Array.from({ length: size.songs }, (_, i): SeedSong => {
    const album = albums[i % size.albums]!;
    const trackNumber = Math.floor(i / size.albums) + 1;
    const title = combination(i, VERBS, PLACES);
    const frames = Math.round(((120 + Math.floor(next() * 240)) * SAMPLE_RATE) / FRAME_SAMPLES);
    return {
      file: `${album.artist}/${album.title}/${String(trackNumber).padStart(2, "0")} ${title}.mp3`,
      title,
      artist: album.artist,
      album: album.title,
      genre: album.genre,
      year: album.year,
      trackNumber,
      frames,
      durationMs: Math.round(((frames * FRAME_SAMPLES) / SAMPLE_RATE) * 1000),
    };
  });

  // Playlists: a few big ones and many small, a little under half Library songs.
  const sizes = apportion(
    size.playlistEntries,
    Array.from({ length: size.playlists }, (_, p) => (p + 1) ** -0.8),
  );
  const librarySizes = sizes.map((n) => Math.min(size.songs, Math.round(n * 0.45)));
  const playlistVideos = Math.min(
    sizes.reduce((sum, n, p) => sum + n - librarySizes[p]!, 0),
    Math.round(size.knownVideos * 0.6),
  );
  const streamedPlays = Math.round(size.plays * 0.2);
  const playedVideos = Math.min(streamedPlays, Math.round(size.knownVideos * 0.1));
  const notedVideos = Math.max(0, size.knownVideos - playlistVideos - playedVideos);
  const ytArtists = Array.from({ length: 400 }, (_, i) => combination(i, YT_FIRST, YT_LAST));
  const videos = Array.from(
    { length: playlistVideos + playedVideos + notedVideos },
    (_, i): YtAlbumSong => {
      const artist = ytArtists[Math.floor(next() * ytArtists.length)]!;
      return {
        videoType: "MUSIC_VIDEO_TYPE_ATV",
        videoId: videoId(i, next),
        title: `${combination(i, NOUNS, ADJECTIVES)} Session`,
        artists: [artist],
        album: `${combination(i % 997, ADJECTIVES, VERBS)} Tapes`,
        albumId: null,
        durationMs: (150 + Math.floor(next() * 180)) * 1000,
        artworkUrl: null,
        explicit: false,
      };
    },
  );
  let nextSong = 0;
  let nextVideo = 0;
  const playlists = sizes.map((n, p): SeedPlaylist => {
    const library = librarySizes[p]!;
    const streams = Math.min(n - library, playlistVideos);
    // Mixed evenly, each kind walking on from where the last playlist stopped, so
    // a playlist holds no song twice and every playlist video is in one.
    const entries: SeedEntry[] = [];
    let held = 0;
    let streamed = 0;
    while (held + streamed < library + streams) {
      if (streamed >= streams || (held < library && held * streams <= streamed * library)) {
        entries.push({ source: "library", song: nextSong++ % size.songs });
        held += 1;
      } else {
        entries.push({ source: "stream", video: nextVideo++ % playlistVideos });
        streamed += 1;
      }
    }
    return { name: combination(p, PLAYLIST_WORDS), entries };
  });

  // A year of listening, favouring some songs, a fifth of it streamed.
  const favourite = Array.from({ length: size.songs }, (_, i) => (i * 7_919) % size.songs);
  const plays = Array.from({ length: size.plays }, (_, k): SeedPlay => {
    const streamed = k < streamedPlays;
    const target: SeedEntry = streamed
      ? { source: "stream", video: playlistVideos + (k % Math.max(1, playedVideos)) }
      : { source: "library", song: favourite[Math.floor(size.songs * next() ** 3)]! };
    const durationMs = streamed
      ? (videos[target.source === "stream" ? target.video : 0]!.durationMs ?? 200_000)
      : songs[target.source === "library" ? target.song : 0]!.durationMs;
    const completed = next() < 0.8;
    return {
      startedAt: Math.floor(next() * 365 * DAY_MS),
      listenedMs: completed ? durationMs : 5_000 + Math.floor(next() * 40_000),
      completed,
      target,
    };
  }).sort((a, b) => b.startedAt - a.startedAt);

  return {
    size,
    songs,
    videos,
    playlists,
    plays,
    notedVideos: Array.from({ length: notedVideos }, (_, i) => playlistVideos + playedVideos + i),
    favorites: Array.from(
      { length: Math.min(size.favorites, size.songs) },
      (_, i) => favourite[i]!,
    ),
    follows: artists.slice(0, Math.min(size.follows, artists.length)),
  };
};

/** What the scanner reports for [song]'s file under [root], as the scan saves it. */
export const scannedTrack = (
  song: SeedSong,
  root: string,
  facts: { readonly sizeBytes: number; readonly modifiedAt: number },
): IndexedTrack => ({
  // The scan's `toIndexedTrack`, on what the tag reader reads from the file.
  ...normalizeTrack({
    path: `${root}/${song.file}`,
    title: song.title,
    artist: song.artist,
    album: song.album,
    albumArtist: song.artist,
    genre: song.genre,
    year: String(song.year),
    trackNumber: String(song.trackNumber),
    discNumber: null,
    compilation: false,
    durationMs: song.durationMs,
  }),
  sizeBytes: facts.sizeBytes,
  modifiedAt: facts.modifiedAt,
  sampleRate: SAMPLE_RATE,
  bitrateKbps: SEED_BITRATE_KBPS,
  artworkHash: null,
  hasLyrics: false,
  explicit: explicitFromAdvisory(null),
  loudness: gainTags({}),
  isrc: isrcFromTag(null),
});

/** The names `scripts/perf/perf.ts` opens: the first artist and playlist in their lists. */
export const referenceFixture = (
  catalogue: ReferenceCatalogue,
): { readonly artist: string; readonly playlist: string } => {
  const first = (names: readonly string[]): string =>
    [...names].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))[0]!;
  return {
    artist: first([...new Set(catalogue.songs.map((song) => song.artist))]),
    playlist: first(catalogue.playlists.map((playlist) => playlist.name)),
  };
};

export interface SeedOptions {
  /** The scan root the seed's folder sits in, e.g. `/storage/emulated/0/Music/Wave Seed`. */
  readonly root: string;
  /** The size and modified time of [song]'s file on the device: a scan then finds it unchanged. */
  readonly facts: (song: SeedSong) => { readonly sizeBytes: number; readonly modifiedAt: number };
  readonly now: number;
  /** The default scan root; [root] when absent. */
  readonly scanRoot?: string;
}

/** Writes [catalogue] into [db] through the store, as a scan and a year of use would. */
export const seedReferenceLibrary = (
  db: LibraryDatabase,
  catalogue: ReferenceCatalogue,
  { root, facts, now, scanRoot = root }: SeedOptions,
): void => {
  const splits = creditSplits();
  const tracks = catalogue.songs.map((song) => scannedTrack(song, root, facts(song)));
  const addedAt = now - 400 * DAY_MS;
  for (let i = 0; i < tracks.length; i += 100)
    saveBatch(db, splits, tracks.slice(i, i + 100), [], [], addedAt, { linkEntries: false });
  ensureDefaultRoot(db, scanRoot);
  linkEntries(db, addedAt);
  markScanned(db, [scanRoot], addedAt);

  const ids = new Map(
    db
      .select({ id: schema.tracks.id, path: schema.tracks.path })
      .from(schema.tracks)
      .all()
      .map((row) => [row.path, row.id] as const),
  );
  const trackId = (song: number): number => ids.get(tracks[song]!.path)!;
  const toSong = (entry: SeedEntry): PlaylistSong =>
    entry.source === "library"
      ? { source: "library", trackId: trackId(entry.song) }
      : { source: "stream", song: catalogue.videos[entry.video]! };
  catalogue.playlists.forEach((playlist, p) =>
    createPlaylist(db, playlist.name, playlist.entries.map(toSong), addedAt + p * 60_000),
  );

  let last: { id: number; play: PlayEvent } | null = null;
  for (const seedPlay of catalogue.plays) {
    const { target } = seedPlay;
    const startedAt = now - seedPlay.startedAt - DAY_MS;
    const video = target.source === "stream" ? catalogue.videos[target.video]! : null;
    const durationMs =
      video === null && target.source === "library"
        ? catalogue.songs[target.song]!.durationMs
        : (video?.durationMs ?? null);
    const play: PlayEvent = {
      trackId:
        video === null
          ? String(trackId(target.source === "library" ? target.song : 0))
          : ytTrackId(video.videoId),
      context: null,
      startedAt,
      listenedMs: seedPlay.listenedMs,
      durationMs,
      endReason: seedPlay.completed ? "completed" : "skipped",
      counted: seedPlay.completed || seedPlay.listenedMs >= 30_000,
      source: "phone",
    };
    if (video !== null) noteStreamedSong(db, video, startedAt);
    last = { id: recordPlay(db, play, false, video ?? undefined), play };
  }
  if (last !== null) endPlay(db, last.id, last.play);
  for (const index of catalogue.notedVideos)
    noteStreamedSong(db, catalogue.videos[index]!, now - DAY_MS - (index % 300) * DAY_MS);

  setFavorites(db, catalogue.favorites.map(trackId), true, now - DAY_MS);
  catalogue.follows.forEach((name, i) => saveFollow(db, { name }, "releases", now - i * DAY_MS));
};

/** A database file holding [catalogue], migrated as the app migrates its own. */
export const buildReferenceDatabase = async (
  catalogue: ReferenceCatalogue,
  options: SeedOptions,
): Promise<Uint8Array> => {
  const { client, db: opened } = await openSqlJsDatabase();
  const db = opened as unknown as LibraryDatabase;
  migrateDatabase(db, migrations);
  seedReferenceLibrary(db, catalogue, options);
  const bytes = client.export();
  client.close();
  return bytes;
};
