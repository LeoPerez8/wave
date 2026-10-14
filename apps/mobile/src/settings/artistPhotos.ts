import { persistedSetting } from "@/lib/persistedSetting";

/** Whether Wave downloads artist photos (on unless the owner turned it off). */
const downloadArtistPhotos = persistedSetting<boolean>({
  key: "settings.downloadArtistPhotos",
  synced: true,
  read: (stored) => stored !== "off",
  write: (on) => (on ? null : "off"),
});

export const artistPhotosEnabled = downloadArtistPhotos.get;

export const setArtistPhotosEnabled = downloadArtistPhotos.set;

/** Whether artist photos are downloaded and shown; re-renders when Settings changes it. */
export const useArtistPhotosEnabled = downloadArtistPhotos.useValue;
