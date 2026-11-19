import {
  DOWNLOAD_ARTIST_PHOTOS_SETTING,
  readDownloadArtistPhotos,
  writeDownloadArtistPhotos,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

/** Whether Wave downloads artist photos (on unless the owner turned it off). */
const downloadArtistPhotos = persistedSetting<boolean>({
  key: DOWNLOAD_ARTIST_PHOTOS_SETTING,
  synced: true,
  read: readDownloadArtistPhotos,
  write: writeDownloadArtistPhotos,
});

export const artistPhotosEnabled = downloadArtistPhotos.get;

export const setArtistPhotosEnabled = downloadArtistPhotos.set;

/** Whether artist photos are downloaded and shown; re-renders when Settings changes it. */
export const useArtistPhotosEnabled = downloadArtistPhotos.useValue;
