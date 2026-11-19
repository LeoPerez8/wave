/**
 * Settings › Lyrics and tags › Download artist photos: whether Wave looks artist photos up on
 * Deezer. On unless the owner turned it off, so nothing stored reads as on. The account syncs
 * it, so the phone and the computer keep it under one key.
 */
export const DOWNLOAD_ARTIST_PHOTOS_SETTING = "settings.downloadArtistPhotos";

export const readDownloadArtistPhotos = (stored: string | null | undefined): boolean =>
  stored !== "off";

/** What the key-value store keeps for the switch: null at its default, on. */
export const writeDownloadArtistPhotos = (on: boolean): string | null => (on ? null : "off");
