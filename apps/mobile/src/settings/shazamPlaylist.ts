import { persistedSetting } from "@/lib/persistedSetting";

/** The ordinary playlist Recognize saves into, by its id shared across phones. */
const shazamPlaylist = persistedSetting<string | null>({
  key: "settings.shazamPlaylistId",
  synced: true,
  read: (stored) => (stored === null || stored.trim() === "" ? null : stored),
  write: (id) => id,
});

export const shazamPlaylistId = shazamPlaylist.get;
export const setShazamPlaylistId = shazamPlaylist.set;
