/**
 * Where artwork that no file carries comes from: Deezer's open API, matched by
 * Core's rules. The phone and the desktop share these reads; each owns its
 * files, its cache and when it asks again.
 */
import {
  deezerArtistCandidates,
  deezerArtistSearchUrl,
  deezerTrackCandidates,
  deezerTrackSearchUrl,
  pickArtistPhoto,
  pickDeezerTrack,
  type ArtistPhotoUrls,
  type SongLookup,
} from "@wave/core";

type Fetch = typeof globalThis.fetch;

const json = async (url: string, signal: AbortSignal, fetch: Fetch): Promise<unknown> => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

/**
 * The photo of the artist [name], searched as [query] (Core's `artistPhotoQuery`),
 * or null without a confident match. Throws when Deezer gives no answer.
 */
export const findArtistPhoto = async (
  name: string,
  query: string,
  signal: AbortSignal,
  fetch: Fetch = globalThis.fetch,
): Promise<ArtistPhotoUrls | null> => {
  const candidates = deezerArtistCandidates(
    await json(deezerArtistSearchUrl(query), signal, fetch),
  );
  if (candidates === null) throw new Error("Not a search result");
  return pickArtistPhoto(name, candidates);
};

/**
 * The cover of [video], a missing song's own video: the one it came with, else the cover of
 * the album YouTube Music files it under, read as a YT Music song's download reads its album
 * (the watch page, then the album page). Null when it has none; a read that fails throws.
 */
export const missingSongCover = async (
  video: { readonly videoId: string; readonly artworkUrl: string | null },
  watchSong: (videoId: string) => Promise<{ readonly albumId: string | null }>,
  readAlbum: (albumId: string) => Promise<{ readonly artworkUrl: string | null }>,
): Promise<string | null> => {
  if (video.artworkUrl !== null) return video.artworkUrl;
  const { albumId } = await watchSong(video.videoId);
  return albumId === null ? null : (await readAlbum(albumId)).artworkUrl;
};

const deezerCover = (value: unknown): string | null =>
  typeof value === "string" && /^https:\/\/(?:[\w-]+\.)?dzcdn\.net\//.test(value) ? value : null;

/**
 * The cover of [song]'s album, or null without a confident match (Core's
 * `pickDeezerTrack`). A song with an album tag takes only that album's cover:
 * a compilation's would show the wrong record. Throws when Deezer gives no answer.
 */
export const findSongCover = async (
  song: SongLookup,
  signal: AbortSignal,
  fetch: Fetch = globalThis.fetch,
): Promise<ArtistPhotoUrls | null> => {
  const response = await json(deezerTrackSearchUrl(song), signal, fetch);
  const candidates = deezerTrackCandidates(response);
  if (candidates === null) throw new Error("Not a search result");
  const match = pickDeezerTrack(song, candidates);
  if (match === null || (song.album !== null && song.album !== "" && !match.onSongsAlbum))
    return null;
  const rows = (response as { data: { id?: unknown; album?: Record<string, unknown> }[] }).data;
  const album = rows.find((row) => row.id === match.trackId)?.album;
  const thumbUrl =
    deezerCover(album?.cover_medium) ??
    deezerCover(album?.cover_big) ??
    deezerCover(album?.cover_xl);
  const largeUrl = deezerCover(album?.cover_xl) ?? deezerCover(album?.cover_big) ?? thumbUrl;
  return thumbUrl !== null && largeUrl !== null ? { thumbUrl, largeUrl } : null;
};
