import { finishSteps, mapSteps, indexSteps, sortSteps } from "./buildSteps.ts";
/**
 * Playlist suggestions rank the drawn seed songs' radios with the shared
 * radio ranking; they never read or write global taste or the artist graph.
 */
import { artistNeighbourhoodSteps, type ArtistGraph } from "./artistGraph.ts";
import { catalogSeedKey } from "./candidateCatalog.ts";
import {
  genreAffinity,
  genreProfile,
  genreProfileSteps,
  genreTallySteps,
  tallyProfileSteps,
  type GenreProfileOf,
  type GenreTally,
} from "./genreAffinity.ts";
import { magicArtistKey, type MagicSong } from "./magicQueue.ts";
import { rankRadioSongs, type RadioRankingPage } from "./radioRanking.ts";
import { normalizeSearchText } from "./search.ts";
import {
  growingLibraryMatches,
  libraryFinderSteps,
  libraryMatchesSteps,
  type LibrarySongKey,
} from "./ytMusic.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";

export interface PlaylistRecommendationTrack extends YtAlbumSong {
  readonly id: string;
  readonly source: "library" | "stream";
  readonly genre?: string | null;
  readonly genres?: readonly string[];
  readonly available?: boolean;
  readonly favorite?: boolean;
  readonly downloaded?: boolean;
  /** When it joined the playlist (a playlist entry's, not the Library song's), for the seed draw. */
  readonly addedAt?: number;
}
export interface PlaylistRecommendationFeedback {
  readonly track: PlaylistRecommendationTrack;
  readonly value: -1 | 1;
}
export interface PlaylistRecommendation {
  readonly track: PlaylistRecommendationTrack;
  readonly score: number;
}
export interface PlaylistRecommendationSources {
  readonly library: readonly PlaylistRecommendationTrack[];
  /** The drawn seeds' radios (`drawPlaylistSeeds`), in playback order. */
  readonly pages?: readonly RadioRankingPage[];
  /** The drawn seed songs, whose artists bring Library songs outside the radios; the playlist without. */
  readonly seeds?: readonly PlaylistRecommendationTrack[];
  readonly graph: ArtistGraph | null;
  readonly profileOf?: GenreProfileOf;
  readonly feedback?: readonly PlaylistRecommendationFeedback[];
  /** Recordings consumed or still visible in this recommendation session. */
  readonly exclude?: readonly PlaylistRecommendationTrack[];
  readonly favoriteVideos?: ReadonlySet<string>;
  readonly online?: boolean;
  readonly ytMusicEnabled?: boolean;
}

/** How many slots a playlist's suggestions section has: the offers it shows at once. */
export const PLAYLIST_SHOWN_OFFERS = 5;

/** How many of the visible suggestions one artist may hold. */
export const PLAYLIST_ARTIST_CAP = 2;

/** Extra weight for a song by one of the playlist's artists. */
const PLAYLIST_ARTIST_WEIGHT = 1.5;
/** Extra weight for full genre affinity to the playlist. */
const PLAYLIST_GENRE_WEIGHT = 2;
/** Extra weight for a song from one of the playlist's albums, by the same artist. */
const PLAYLIST_ALBUM_WEIGHT = 0.5;
/** How far the playlist's own feedback moves a radio score (the adjustment stays within ±0.35). */
const PLAYLIST_FEEDBACK_WEIGHT = 4;

/** How recording matching sees [track]. */
const recordingKey = (track: PlaylistRecommendationTrack) => ({
  ...track,
  artist: track.artists.join(" & "),
  durationMs: track.durationMs ?? 0,
});

/** Same recording rules as integrated Library/YT Music pages, including remasters and duration. */
export const playlistRecordingMatch = (tracks: readonly PlaylistRecommendationTrack[]) =>
  finishSteps(playlistRecordingMatchSteps(tracks));

export function* playlistRecordingMatchSteps(tracks: readonly PlaylistRecommendationTrack[]) {
  const byId = yield* indexSteps(tracks, (track) => [track.id, track]);
  const byVideo = new Map<string, PlaylistRecommendationTrack>();
  for (const track of tracks) {
    if (track.videoId !== "") byVideo.set(track.videoId, track);
    yield;
  }
  const keys = yield* mapSteps(tracks, recordingKey);
  const find = yield* libraryFinderSteps(keys);
  return (
    song: Pick<PlaylistRecommendationTrack, "title" | "artists" | "durationMs"> & {
      readonly id?: string;
      readonly videoId?: string;
    },
  ) =>
    (song.id === undefined ? undefined : byId.get(song.id)) ??
    (song.videoId === undefined ? undefined : byVideo.get(song.videoId)) ??
    find(song);
}

const sameTrackField = (a: unknown, b: unknown): boolean =>
  a === b ||
  (Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => value === b[index]));

const sameTrack = (a: PlaylistRecommendationTrack, b: PlaylistRecommendationTrack): boolean => {
  const fields = Object.keys(a) as (keyof PlaylistRecommendationTrack)[];
  return (
    fields.length === Object.keys(b).length &&
    fields.every((field) => sameTrackField(a[field], b[field]))
  );
};

/**
 * Whether two reads hold the same tracks, in the same order. A play or a playlist write makes the
 * Library read again without changing a track: the same answer lets its first array, and so its
 * ranking indexes, stand.
 */
export function* samePlaylistTracksSteps(
  a: readonly PlaylistRecommendationTrack[],
  b: readonly PlaylistRecommendationTrack[],
): Generator<void, boolean> {
  if (a.length !== b.length) return false;
  for (const [index, track] of a.entries()) {
    if (!sameTrack(track, b[index]!)) return false;
    yield;
  }
  return true;
}

/** `samePlaylistTracksSteps` all at once. */
export const samePlaylistTracks = (
  a: readonly PlaylistRecommendationTrack[],
  b: readonly PlaylistRecommendationTrack[],
): boolean => finishSteps(samePlaylistTracksSteps(a, b));

/** What ranking looks up in a Library, whichever playlist it ranks for. */
interface PlaylistLibraryIndex {
  /** The genres of the Library's songs under each artist key, added up and as a profile. */
  readonly artistTallies: ReadonlyMap<string, GenreTally>;
  readonly artistProfiles: ReadonlyMap<string, ReturnType<typeof genreProfile>>;
  readonly recording: ReturnType<typeof playlistRecordingMatch>;
  readonly magicOf: ReadonlyMap<string, MagicSong>;
  readonly magicSongs: readonly MagicSong[];
  /** The songs with a file, by id. */
  readonly withFile: ReadonlyMap<string, PlaylistRecommendationTrack>;
}

/**
 * By the Library array, which a new read replaces when the Library or its stars change, so an
 * index lives as long as its Library. Only a finished build is kept: cancelled, the next starts over.
 */
const libraryIndexes = new WeakMap<readonly PlaylistRecommendationTrack[], PlaylistLibraryIndex>();

/** [library]'s index, built once however many rankings and playlists read it. */
export function* playlistLibraryIndexSteps(
  library: readonly PlaylistRecommendationTrack[],
): Generator<void, PlaylistLibraryIndex> {
  const known = libraryIndexes.get(library);
  if (known !== undefined) return known;
  const songsOfArtist = new Map<string, PlaylistRecommendationTrack[]>();
  for (const track of library) {
    for (const artist of track.artists) {
      const key = catalogSeedKey(artist);
      if (key === null) continue;
      const songs = songsOfArtist.get(key) ?? [];
      songs.push(track);
      songsOfArtist.set(key, songs);
      yield;
    }
    yield;
  }
  const artistTallies = new Map<string, GenreTally>();
  const artistProfiles = new Map<string, ReturnType<typeof genreProfile>>();
  for (const [name, songs] of songsOfArtist) {
    const tally = yield* genreTallySteps(songs);
    artistTallies.set(name, tally);
    artistProfiles.set(name, yield* tallyProfileSteps(tally));
    yield;
  }
  const local: PlaylistRecommendationTrack[] = [];
  for (const track of library) {
    if (track.available !== false) local.push(track);
    yield;
  }
  const recording = yield* playlistRecordingMatchSteps(local);
  const magicOf = new Map<string, MagicSong>();
  for (const track of local) {
    magicOf.set(track.id, {
      trackId: track.id,
      artists: track.artists.map(magicArtistKey),
      genre: null,
      style: null,
    });
    yield;
  }
  const withFile = yield* indexSteps(local, (track) => [track.id, track]);
  const index: PlaylistLibraryIndex = {
    artistTallies,
    artistProfiles,
    recording,
    magicOf,
    magicSongs: [...magicOf.values()],
    withFile,
  };
  libraryIndexes.set(library, index);
  return index;
}

/** Full eligible order, shared with the visible-slot controller. */
function* rankedPlaylistRecommendationsSteps(
  playlist: readonly PlaylistRecommendationTrack[],
  sources: PlaylistRecommendationSources,
): Generator<void, PlaylistRecommendation[]> {
  if (playlist.length === 0) return [];
  const { library, graph } = sources;
  const index = yield* playlistLibraryIndexSteps(library);
  // A playlist's own songs lean its artists' genres, and no other playlist's: added per ranking.
  const ownSongs = new Map<string, PlaylistRecommendationTrack[]>();
  for (const track of playlist) {
    for (const artist of track.artists) {
      const key = catalogSeedKey(artist);
      if (key === null) continue;
      const songs = ownSongs.get(key) ?? [];
      songs.push(track);
      ownSongs.set(key, songs);
      yield;
    }
    yield;
  }
  const ownProfiles = new Map<string, ReturnType<typeof genreProfile>>();
  for (const [name, songs] of ownSongs) {
    const tally = yield* genreTallySteps(songs, index.artistTallies.get(name));
    ownProfiles.set(name, yield* tallyProfileSteps(tally));
    yield;
  }
  const profileOf: GenreProfileOf = (name) => {
    const key = catalogSeedKey(name) ?? "";
    return (
      (ownProfiles.has(key) ? ownProfiles.get(key) : index.artistProfiles.get(key)) ??
      sources.profileOf?.(name)
    );
  };
  let profile = yield* genreProfileSteps(playlist);
  if (profile === null) {
    const weights = new Map<string, number>();
    let known = 0;
    for (const track of playlist) {
      for (const artist of track.artists) {
        yield;
        const artistProfile = profileOf(artist);
        if (artistProfile == null || artistProfile.size === 0) continue;
        known += 1;
        for (const [family, share] of artistProfile)
          weights.set(family, (weights.get(family) ?? 0) + share);
      }
      yield;
    }
    if (known > 0)
      profile = new Map([...weights].map(([family, weight]) => [family, weight / known]));
  }
  const artistSignals = new Map<string, number>();
  const genreSignals = new Map<string, number>();
  const signals = sources.feedback ?? [];
  const exact = yield* libraryMatchesSteps(
    yield* mapSteps(signals, (signal) => ({
      ...signal,
      title: signal.track.title,
      artist: signal.track.artists.join(" & "),
      durationMs: signal.track.durationMs ?? 0,
    })),
  );
  for (const signal of signals) {
    for (const name of signal.track.artists) {
      const key = catalogSeedKey(name);
      if (key !== null) artistSignals.set(key, (artistSignals.get(key) ?? 0) + signal.value * 0.18);
    }
    if (graph !== null)
      for (const near of yield* artistNeighbourhoodSteps(graph, signal.track.artists))
        artistSignals.set(
          near.key,
          (artistSignals.get(near.key) ?? 0) + signal.value * near.closeness * 0.08,
        );
    const genres = genreProfile([signal.track]) ?? profileOf(signal.track.artists[0] ?? "");
    for (const [family, share] of genres ?? [])
      genreSignals.set(family, (genreSignals.get(family) ?? 0) + signal.value * share * 0.06);
    yield;
  }
  const adjustment = (track: PlaylistRecommendationTrack) => {
    const artist =
      track.artists.reduce(
        (sum, name) => sum + (artistSignals.get(catalogSeedKey(name) ?? "") ?? 0),
        0,
      ) / Math.max(1, track.artists.length);
    const genres = genreProfile([track]) ?? profileOf(track.artists[0] ?? "");
    let genre = 0;
    for (const [family, share] of genres ?? []) genre += (genreSignals.get(family) ?? 0) * share;
    const recording = exact(track).reduce((sum, signal) => sum + signal.value, 0);
    return Math.max(-0.35, Math.min(0.35, artist + genre + recording * 0.1));
  };
  const present = yield* playlistRecordingMatchSteps(playlist);
  const excluded = yield* playlistRecordingMatchSteps(sources.exclude ?? []);
  // A dismissed recording never returns, unless the playlist accepted it since.
  const accepted = yield* playlistRecordingMatchSteps(
    signals.flatMap((signal) => (signal.value === 1 ? [signal.track] : [])),
  );
  const dismissed = yield* playlistRecordingMatchSteps(
    signals.flatMap((signal) =>
      signal.value === -1 && accepted(signal.track) === null ? [signal.track] : [],
    ),
  );
  const playlistArtists = new Set<string>();
  for (const track of playlist) {
    for (const artist of track.artists) {
      const key = catalogSeedKey(artist);
      if (key !== null) playlistArtists.add(key);
      yield;
    }
    yield;
  }
  const seedArtists = new Set<string>();
  for (const track of sources.seeds ?? playlist) {
    for (const artist of track.artists) {
      seedArtists.add(artist);
      yield;
    }
    yield;
  }
  const streams = sources.online !== false && sources.ytMusicEnabled !== false;
  const ranked = rankRadioSongs(
    { artists: [...seedArtists], profile },
    {
      pages: sources.pages ?? [],
      graph,
      profileOf,
      library: index.magicSongs,
      inLibrary: (song) => {
        const found = index.recording(song);
        return found === null ? null : (index.magicOf.get(found.id) ?? null);
      },
    },
  );
  yield;
  const albums = new Map<string, Set<string | null>>();
  for (const seed of playlist) {
    if (seed.album !== null) {
      const album = normalizeSearchText(seed.album);
      const artists = albums.get(album) ?? new Set<string | null>();
      for (const name of seed.artists) {
        artists.add(catalogSeedKey(name));
        yield;
      }
      albums.set(album, artists);
    }
    yield;
  }
  /** How alike the playlist [track] is: its artists, its genre, its album. */
  const similarity = (track: PlaylistRecommendationTrack) => {
    const artist = track.artists.some((name) => playlistArtists.has(catalogSeedKey(name) ?? ""))
      ? PLAYLIST_ARTIST_WEIGHT
      : 0;
    const genres = genreProfile([track]) ?? profileOf(track.artists[0] ?? "");
    const genre =
      profile === null || genres == null || genres.size === 0
        ? 0
        : PLAYLIST_GENRE_WEIGHT * genreAffinity(profile, genres);
    const albumArtists =
      track.album === null ? undefined : albums.get(normalizeSearchText(track.album));
    const sameAlbum =
      albumArtists !== undefined &&
      track.artists.some((name) => albumArtists.has(catalogSeedKey(name)));
    return artist + genre + (sameAlbum ? PLAYLIST_ALBUM_WEIGHT : 0);
  };
  const result: PlaylistRecommendation[] = [];
  for (const candidate of ranked) {
    yield;
    const track =
      candidate.source === "library"
        ? index.withFile.get(candidate.trackId)
        : candidate.song === null || !streams
          ? undefined
          : {
              ...candidate.song,
              id: candidate.trackId,
              favorite: sources.favoriteVideos?.has(candidate.song.videoId) === true,
              source: "stream" as const,
            };
    if (
      track === undefined ||
      present(track) !== null ||
      excluded(track) !== null ||
      dismissed(track) !== null
    )
      continue;
    result.push({
      track,
      score: candidate.score + similarity(track) + PLAYLIST_FEEDBACK_WEIGHT * adjustment(track),
    });
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- fresh results, Hermes lacks toSorted
  const priority = (track: PlaylistRecommendationTrack) =>
    Number(track.favorite === true || track.downloaded === true);
  return yield* sortSteps(
    result,
    (a, b) =>
      priority(b.track) - priority(a.track) ||
      b.score - a.score ||
      a.track.id.localeCompare(b.track.id),
  );
}

const artistKeys = (track: PlaylistRecommendationTrack) =>
  new Set(track.artists.flatMap((name) => catalogSeedKey(name) ?? []));

/**
 * What a suggestion is checked against, as offers join: not a recording they
 * hold, and by no artist already holding `PLAYLIST_ARTIST_CAP` of them.
 */
const offerPicks = () => {
  const ids = new Set<string>();
  const videos = new Set<string>();
  const recordings = growingLibraryMatches<LibrarySongKey>();
  const counts = new Map<string, number>();
  return {
    add: (track: PlaylistRecommendationTrack): void => {
      ids.add(track.id);
      if (track.videoId !== "") videos.add(track.videoId);
      recordings.add(recordingKey(track));
      for (const key of artistKeys(track)) counts.set(key, (counts.get(key) ?? 0) + 1);
    },
    fits: (track: PlaylistRecommendationTrack): boolean =>
      !ids.has(track.id) &&
      !videos.has(track.videoId) &&
      recordings.matches(track).length === 0 &&
      [...artistKeys(track)].every((key) => (counts.get(key) ?? 0) < PLAYLIST_ARTIST_CAP),
  };
};

/** Whether a suggestion may join the [shown] ones (`offerPicks`). */
export const playlistOfferFits = (shown: readonly PlaylistRecommendationTrack[]) => {
  const picks = offerPicks();
  for (const track of shown) picks.add(track);
  return picks.fits;
};

export function* playlistRecommendationsSteps(
  playlist: readonly PlaylistRecommendationTrack[],
  sources: PlaylistRecommendationSources,
  count = PLAYLIST_SHOWN_OFFERS,
): Generator<void, PlaylistRecommendation[]> {
  const picked: PlaylistRecommendation[] = [];
  const picks = offerPicks();
  for (const candidate of yield* rankedPlaylistRecommendationsSteps(playlist, sources)) {
    yield;
    if (!picks.fits(candidate.track)) continue;
    picks.add(candidate.track);
    picked.push(candidate);
    if (picked.length === count) break;
  }
  return picked;
}

export const playlistRecommendations = (
  playlist: readonly PlaylistRecommendationTrack[],
  sources: PlaylistRecommendationSources,
  count = PLAYLIST_SHOWN_OFFERS,
): PlaylistRecommendation[] => finishSteps(playlistRecommendationsSteps(playlist, sources, count));
