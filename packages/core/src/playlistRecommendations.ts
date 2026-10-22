import { artistNeighbourhood } from "./artistGraph.ts";
/** Playlist selection uses the shared recommendation engine; it never reads or writes global taste. */
import { catalogSeedKey, type CatalogSong } from "./candidateCatalog.ts";
import { genreProfile, type GenreProfileOf } from "./genreAffinity.ts";
import { recommend, type RecommendSources } from "./recommend.ts";
import { normalizeSearchText } from "./search.ts";
import { libraryFinder, libraryMatches } from "./ytMusic.ts";
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
export const playlistRecordingMatch = (tracks: readonly PlaylistRecommendationTrack[]) => {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const byVideo = new Map(
    tracks.filter((track) => track.videoId !== "").map((track) => [track.videoId, track]),
  );
  const find = libraryFinder(
    tracks.map((track) => ({
      ...track,
      artist: track.artists.join(" & "),
      durationMs: track.durationMs ?? 0,
    })),
  );
  return (
    song: Pick<PlaylistRecommendationTrack, "title" | "artists" | "durationMs"> & {
      readonly id?: string;
      readonly videoId?: string;
    },
  ) =>
    (song.id === undefined ? undefined : byId.get(song.id)) ??
    (song.videoId === undefined ? undefined : byVideo.get(song.videoId)) ??
    find(song);
};

/** Full eligible order, shared with the visible-slot controller. */
export const rankedPlaylistRecommendations = (
  playlist: readonly PlaylistRecommendationTrack[],
  sources: PlaylistRecommendationSources,
): PlaylistRecommendation[] => {
  if (playlist.length === 0) return [];
  const { library, catalog, graph, now } = sources;
  const profiles = new Map<string, PlaylistRecommendationTrack[]>();
  for (const track of [...library, ...playlist])
    for (const artist of track.artists) {
      const key = catalogSeedKey(artist);
      if (key === null) continue;
      const songs = profiles.get(key) ?? [];
      songs.push(track);
      profiles.set(key, songs);
    }
  const taggedProfiles = new Map([...profiles].map(([name, songs]) => [name, genreProfile(songs)]));
  const profileOf: GenreProfileOf = (name) =>
    taggedProfiles.get(catalogSeedKey(name) ?? "") ?? sources.profileOf?.(name);
  let profile = genreProfile(playlist);
  if (profile === null) {
    const weights = new Map<string, number>();
    let known = 0;
    for (const track of playlist)
      for (const artist of track.artists) {
        const artistProfile = profileOf(artist);
        if (artistProfile == null || artistProfile.size === 0) continue;
        known += 1;
        for (const [family, share] of artistProfile)
          weights.set(family, (weights.get(family) ?? 0) + share);
      }
    if (known > 0)
      profile = new Map([...weights].map(([family, weight]) => [family, weight / known]));
  }
  const artistSignals = new Map<string, number>();
  const genreSignals = new Map<string, number>();
  const signals = sources.feedback ?? [];
  const exact = libraryMatches(
    signals.map((signal) => ({
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
      for (const near of artistNeighbourhood(graph, signal.track.artists))
        artistSignals.set(
          near.key,
          (artistSignals.get(near.key) ?? 0) + signal.value * near.closeness * 0.08,
        );
    const genres = genreProfile([signal.track]) ?? profileOf(signal.track.artists[0] ?? "");
    for (const [family, share] of genres ?? [])
      genreSignals.set(family, (genreSignals.get(family) ?? 0) + signal.value * share * 0.06);
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
  const present = playlistRecordingMatch(playlist);
  const excluded = playlistRecordingMatch(sources.exclude ?? []);
  const local = library.filter((track) => track.available !== false);
  const localRecording = playlistRecordingMatch(local);
  const tracks: PlaylistRecommendationTrack[] = [
    ...local,
    ...(sources.online === false || sources.ytMusicEnabled === false
      ? []
      : catalog.flatMap(({ song }) =>
          localRecording(song) !== null
            ? []
            : [
                {
                  ...song,
                  id: `yt:${song.videoId}`,
                  favorite: sources.favoriteVideos?.has(song.videoId) === true,
                  source: "stream" as const,
                },
              ],
        )),
  ];
  const byId = new Map(tracks.map((track) => [track.id, track]));
  // Each Library song's own tags take precedence over an artist's broader profile.
  const syntheticProfiles = new Map(tracks.map((track) => [track.id, genreProfile([track])]));
  const radios = new Map(catalog.map((entry) => [`yt:${entry.song.videoId}`, entry.radios]));
  const engineCatalog = tracks.map((track) => ({
    song: { ...track, videoId: track.id, artists: track.artists },
    firstSeenAt: now,
    lastSeenAt: now,
    radios: radios.get(track.id) ?? [],
  }));
  const ranked = recommend(
    { artists: playlist.flatMap((track) => track.artists), profile, matchGenres: true },
    {
      catalog: engineCatalog,
      graph,
      now,
      profileOf,
      songProfileOf: (song) => syntheticProfiles.get(song.videoId),
    },
    { weights: { closeness: 1, affinity: 1, taste: 0, newness: 0, popularity: 0, variety: 0 } },
  );
  const result: PlaylistRecommendation[] = [];
  for (const candidate of ranked) {
    const track = byId.get(candidate.song.videoId);
    if (
      track === undefined ||
      candidate.affinity !== "match" ||
      present(track) !== null ||
      excluded(track) !== null ||
      playlist.some(
        (seed) => seed.id === track.id || (seed.videoId !== "" && seed.videoId === track.videoId),
      )
    )
      continue;
    const sameAlbum =
      track.album !== null &&
      playlist.some(
        (seed) =>
          seed.album !== null &&
          normalizeSearchText(seed.album) === normalizeSearchText(track.album!) &&
          seed.artists.some((a) =>
            track.artists.some((b) => catalogSeedKey(a) === catalogSeedKey(b)),
          ),
      );
    result.push({ track, score: candidate.score + (sameAlbum ? 0.25 : 0) + adjustment(track) });
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- fresh results, Hermes lacks toSorted
  const priority = (track: PlaylistRecommendationTrack) =>
    Number(track.favorite === true || track.downloaded === true);
  result.sort(
    (a, b) =>
      priority(b.track) - priority(a.track) ||
      b.score - a.score ||
      a.track.id.localeCompare(b.track.id),
  );
  return result;
};

export const playlistRecommendations = (
  playlist: readonly PlaylistRecommendationTrack[],
  sources: PlaylistRecommendationSources,
): PlaylistRecommendation[] => {
  const picked: PlaylistRecommendation[] = [];
  for (const candidate of rankedPlaylistRecommendations(playlist, sources)) {
    if (playlistRecordingMatch(picked.map((item) => item.track))(candidate.track) !== null)
      continue;
    picked.push(candidate);
    if (picked.length === 5) break;
  }
  return picked;
};
