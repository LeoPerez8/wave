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
  type GenreProfileOf,
} from "./genreAffinity.ts";
import { magicArtistKey, type MagicSong } from "./magicQueue.ts";
import { rankRadioSongs, type RadioRankingPage } from "./radioRanking.ts";
import { normalizeSearchText } from "./search.ts";
import { libraryFinderSteps, libraryMatchesSteps } from "./ytMusic.ts";
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
  const keys = yield* mapSteps(tracks, (track) => ({
    ...track,
    artist: track.artists.join(" & "),
    durationMs: track.durationMs ?? 0,
  }));
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

/** Full eligible order, shared with the visible-slot controller. */
function* rankedPlaylistRecommendationsSteps(
  playlist: readonly PlaylistRecommendationTrack[],
  sources: PlaylistRecommendationSources,
): Generator<void, PlaylistRecommendation[]> {
  if (playlist.length === 0) return [];
  const { library, graph } = sources;
  const profiles = new Map<string, PlaylistRecommendationTrack[]>();
  for (const track of (function* () {
    yield* library;
    yield* playlist;
  })()) {
    for (const artist of track.artists) {
      const key = catalogSeedKey(artist);
      if (key === null) continue;
      const songs = profiles.get(key) ?? [];
      songs.push(track);
      profiles.set(key, songs);
      yield;
    }
    yield;
  }
  const taggedProfiles = new Map<string, ReturnType<typeof genreProfile>>();
  for (const [name, songs] of profiles) {
    taggedProfiles.set(name, yield* genreProfileSteps(songs));
    yield;
  }
  const profileOf: GenreProfileOf = (name) =>
    taggedProfiles.get(catalogSeedKey(name) ?? "") ?? sources.profileOf?.(name);
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
  const local: PlaylistRecommendationTrack[] = [];
  for (const track of library) {
    if (track.available !== false) local.push(track);
    yield;
  }
  const localRecording = yield* playlistRecordingMatchSteps(local);
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
  const byId = yield* indexSteps(local, (track) => [track.id, track]);
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
      library: [...magicOf.values()],
      inLibrary: (song) => {
        const found = localRecording(song);
        return found === null ? null : (magicOf.get(found.id) ?? null);
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
        ? byId.get(candidate.trackId)
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
 * Whether a suggestion may join the [shown] ones: not a recording they
 * hold, and by no artist already holding `PLAYLIST_ARTIST_CAP` of them.
 */
export const playlistOfferFits = (shown: readonly PlaylistRecommendationTrack[]) => {
  const occupied = playlistRecordingMatch(shown);
  const counts = new Map<string, number>();
  for (const track of shown)
    for (const key of artistKeys(track)) counts.set(key, (counts.get(key) ?? 0) + 1);
  return (track: PlaylistRecommendationTrack): boolean =>
    occupied(track) === null &&
    [...artistKeys(track)].every((key) => (counts.get(key) ?? 0) < PLAYLIST_ARTIST_CAP);
};

export function* playlistRecommendationsSteps(
  playlist: readonly PlaylistRecommendationTrack[],
  sources: PlaylistRecommendationSources,
  count = 5,
): Generator<void, PlaylistRecommendation[]> {
  const picked: PlaylistRecommendation[] = [];
  for (const candidate of yield* rankedPlaylistRecommendationsSteps(playlist, sources)) {
    yield;
    if (!playlistOfferFits(picked.map((item) => item.track))(candidate.track)) continue;
    picked.push(candidate);
    if (picked.length === count) break;
  }
  return picked;
}

export const playlistRecommendations = (
  playlist: readonly PlaylistRecommendationTrack[],
  sources: PlaylistRecommendationSources,
  count = 5,
): PlaylistRecommendation[] => finishSteps(playlistRecommendationsSteps(playlist, sources, count));
