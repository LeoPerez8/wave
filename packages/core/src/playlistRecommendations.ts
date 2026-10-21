/** Playlist selection uses the shared recommendation engine; it never reads or writes global taste. */
import { catalogSeedKey, type CatalogSong } from "./candidateCatalog.ts";
import { genreProfile, type GenreProfileOf } from "./genreAffinity.ts";
import { recommend, type RecommendSources } from "./recommend.ts";
import { normalizeSearchText } from "./search.ts";
import { libraryFinder } from "./ytMusic.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";

export interface PlaylistRecommendationTrack extends YtAlbumSong {
  readonly id: string;
  readonly source: "library" | "stream";
  readonly genre?: string | null;
  readonly genres?: readonly string[];
  readonly available?: boolean;
}
export interface PlaylistRecommendation {
  readonly track: PlaylistRecommendationTrack;
  readonly score: number;
}
export interface PlaylistRecommendationSources extends Pick<RecommendSources, "graph" | "now"> {
  readonly library: readonly PlaylistRecommendationTrack[];
  readonly catalog: readonly CatalogSong[];
  readonly profileOf?: GenreProfileOf;
  readonly online?: boolean;
  readonly ytMusicEnabled?: boolean;
}

/** Same recording rules as integrated Library/YT Music pages, including remasters and duration. */
export const playlistRecordingMatch = (tracks: readonly PlaylistRecommendationTrack[]) =>
  libraryFinder(
    tracks.map((track) => ({
      ...track,
      artist: track.artists.join(" & "),
      durationMs: track.durationMs ?? 0,
    })),
  );

export const playlistRecommendations = (
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
  const profile =
    genreProfile(playlist) ??
    genreProfile(
      playlist.flatMap((track) =>
        track.artists.flatMap((name) =>
          [...(profileOf(name)?.keys() ?? [])].map((genre) => ({ genre })),
        ),
      ),
    );
  const present = playlistRecordingMatch(playlist);
  const local = library.filter((track) => track.available !== false);
  const localRecording = playlistRecordingMatch(local);
  const tracks: PlaylistRecommendationTrack[] = [
    ...local,
    ...(sources.online === false || sources.ytMusicEnabled === false
      ? []
      : catalog.flatMap(({ song }) =>
          localRecording(song) !== null
            ? []
            : [{ ...song, id: `yt:${song.videoId}`, source: "stream" as const }],
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
    result.push({ track, score: candidate.score + (sameAlbum ? 0.25 : 0) });
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- fresh results, Hermes lacks toSorted
  result.sort((a, b) => b.score - a.score || a.track.id.localeCompare(b.track.id));
  const picked: PlaylistRecommendation[] = [];
  for (const candidate of result) {
    if (playlistRecordingMatch(picked.map((item) => item.track))(candidate.track) !== null)
      continue;
    picked.push(candidate);
    if (picked.length === 5) break;
  }
  return picked;
};
