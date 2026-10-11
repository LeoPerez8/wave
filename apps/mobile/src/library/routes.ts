import { router } from "expo-router";

/** Detail screens (ids are DB integer ids); other tickets link to these. */
export const albumHref = (id: number) => `/library/album/${id}` as const;
export const artistHref = (id: number) => `/library/artist/${id}` as const;
export const genreHref = (id: number) => `/library/genre/${id}` as const;
export const folderHref = (id: number) => `/library/folder/${id}` as const;

export const openAlbum = (id: number): void => router.push(albumHref(id));
export const openArtist = (id: number): void => router.push(artistHref(id));
export const openGenre = (id: number): void => router.push(genreHref(id));
export const openFolder = (id: number): void => router.push(folderHref(id));

/** Parses a route's `[id]` param; NaN-safe (an unknown id shows the "gone" state). */
export const parseId = (param: string | string[] | undefined): number => {
  const id = Number(Array.isArray(param) ? param[0] : param);
  return Number.isInteger(id) ? id : -1;
};
