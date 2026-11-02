import { readPlaylistSongSort, type PlaylistSongSort } from "@wave/core";
import { persistedSetting } from "@/lib/persistedSetting";
const listeners = new Set<() => void>();
export const onPlaylistSongSortChanged = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const settings = new Map<string, ReturnType<typeof makeSetting>>();
const makeSetting = (id: string) =>
  persistedSetting<PlaylistSongSort>({
    key: `settings.playlistSongs.${id}`,
    synced: true,
    read: readPlaylistSongSort,
    write: JSON.stringify,
    onValue: () => {
      for (const listener of listeners) listener();
    },
  });
export const playlistSongSetting = (id: string) => {
  let setting = settings.get(id);
  if (!setting) {
    setting = makeSetting(id);
    settings.set(id, setting);
  }
  return setting;
};
