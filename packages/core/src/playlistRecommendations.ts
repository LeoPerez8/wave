import { finishSteps, mapSteps, indexSteps, sortSteps } from "./buildSteps.ts";
import { artistNeighbourhoodSteps } from "./artistGraph.ts";
/** Playlist selection uses the shared recommendation engine; it never reads or writes global taste. */
import { catalogSeedKey, type CatalogSong } from "./candidateCatalog.ts";
import { genreProfile, genreProfileSteps, type GenreProfileOf } from "./genreAffinity.ts";
import {
  recommendCandidatesSteps,
  rankRecommendedSteps,
  type RecommendSources,
} from "./recommend.ts";
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
}
export interface PlaylistRecommendationFeedback {
  readonly track: PlaylistRecommendationTrack;
  readonly value: -1 | 1;
}
export interface PlaylistRecommendation {
  readonly track: PlaylistRecommendationTrack;
  readonly score: number;
}
export interface PlaylistRecommendationSources extends Pick<RecommendSources, "graph" | "now"> {
  readonly library: readonly PlaylistRecommendationTrack[];
  readonly catalog: readonly CatalogSong[];
  readonly profileOf?: GenreProfileOf;
  readonly feedback?: readonly PlaylistRecommendationFeedback[];
  /** Recordings consumed or still visible in this recommendation session. */
  readonly exclude?: readonly PlaylistRecommendationTrack[];
  readonly favoriteVideos?: ReadonlySet<string>;
  readonly online?: boolean;
  readonly ytMusicEnabled?: boolean;
}

/** Same recording rules as integrated Library/YT Music pages, including remasters and duration. */
export const playlistRecordingMatch = (tracks: readonly PlaylistRecommendationTrack[]) =>
  finishSteps(playlistRecordingMatchSteps(tracks));

function* playlistRecordingMatchSteps(tracks: readonly PlaylistRecommendationTrack[]) {
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
  const { library, catalog, graph, now } = sources;
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
  const local: PlaylistRecommendationTrack[] = [];
  for (const track of library) {
    if (track.available !== false) local.push(track);
    yield;
  }
  const localRecording = yield* playlistRecordingMatchSteps(local);
  const tracks = yield* mapSteps(local, (track) => track);
  if (sources.online !== false && sources.ytMusicEnabled !== false)
    for (const { song } of catalog) {
      if (localRecording(song) === null)
        tracks.push({
          ...song,
          id: `yt:${song.videoId}`,
          favorite: sources.favoriteVideos?.has(song.videoId) === true,
          source: "stream",
        });
      yield;
    }
  const byId = yield* indexSteps(tracks, (track) => [track.id, track]);
  const syntheticProfiles = yield* indexSteps(tracks, (track) => [track.id, genreProfile([track])]);
  const radios = yield* indexSteps(catalog, (entry) => [`yt:${entry.song.videoId}`, entry.radios]);
  const engineCatalog = yield* mapSteps(tracks, (track) => ({
    song: { ...track, videoId: track.id, artists: track.artists },
    firstSeenAt: now,
    lastSeenAt: now,
    radios: radios.get(track.id) ?? [],
  }));
  const seedArtists: string[] = [];
  for (const track of playlist) {
    for (const artist of track.artists) {
      seedArtists.push(artist);
      yield;
    }
    yield;
  }
  const ranked = yield* rankRecommendedSteps(
    yield* recommendCandidatesSteps(
      { artists: seedArtists, profile, matchGenres: true },
      {
        catalog: engineCatalog,
        graph,
        now,
        profileOf,
        songProfileOf: (song) => syntheticProfiles.get(song.videoId),
      },
    ),
    { weights: { closeness: 1, affinity: 1, taste: 0, newness: 0, popularity: 0, variety: 0 } },
  );
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
  const result: PlaylistRecommendation[] = [];
  for (const candidate of ranked) {
    yield;
    const track = byId.get(candidate.song.videoId);
    if (
      track === undefined ||
      candidate.affinity !== "match" ||
      present(track) !== null ||
      excluded(track) !== null
    )
      continue;
    const albumArtists =
      track.album === null ? undefined : albums.get(normalizeSearchText(track.album));
    const sameAlbum =
      albumArtists !== undefined &&
      track.artists.some((name) => albumArtists.has(catalogSeedKey(name)));
    result.push({ track, score: candidate.score + (sameAlbum ? 0.25 : 0) + adjustment(track) });
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

export function* playlistRecommendationsSteps(
  playlist: readonly PlaylistRecommendationTrack[],
  sources: PlaylistRecommendationSources,
): Generator<void, PlaylistRecommendation[]> {
  const picked: PlaylistRecommendation[] = [];
  for (const candidate of yield* rankedPlaylistRecommendationsSteps(playlist, sources)) {
    yield;
    if (playlistRecordingMatch(picked.map((item) => item.track))(candidate.track) !== null)
      continue;
    picked.push(candidate);
    if (picked.length === 5) break;
  }
  return picked;
}

export const playlistRecommendations = (
  playlist: readonly PlaylistRecommendationTrack[],
  sources: PlaylistRecommendationSources,
): PlaylistRecommendation[] => finishSteps(playlistRecommendationsSteps(playlist, sources));
