import { deezerArtistSearchUrl } from "./artistPhoto.ts";
import { resolveDeezerFollowArtist } from "./followedArtists.ts";
import { genreProfile, type GenreProfile } from "./genreAffinity.ts";
import { deezerAlbum, deezerAlbumUrl } from "./lyricsAndGenre.ts";
import { isRecord } from "./storedJson.ts";

/** Infer a profile from up to three releases after resolving the exact artist name. */
export const lookUpDeezerArtistGenre = async (
  name: string,
  json: (url: string) => Promise<unknown>,
): Promise<GenreProfile | null> => {
  const artists = await json(deezerArtistSearchUrl(name));
  if (!isRecord(artists) || !Array.isArray(artists.data))
    throw new Error("Invalid Deezer artist response");
  const id = resolveDeezerFollowArtist(artists, name);
  if (id === null) return null;
  const albums = await json(`https://api.deezer.com/artist/${id}/albums?limit=3`);
  if (!isRecord(albums) || !Array.isArray(albums.data)) throw new Error("Invalid Deezer releases");
  const tags: { genre: string | null }[] = [];
  for (const entry of (albums.data as unknown[]).slice(0, 3)) {
    if (!isRecord(entry) || typeof entry.id !== "number") continue;
    const album = deezerAlbum(await json(deezerAlbumUrl(entry.id)));
    if (album === null) throw new Error("Invalid Deezer album response");
    tags.push(album);
  }
  return genreProfile(tags);
};
