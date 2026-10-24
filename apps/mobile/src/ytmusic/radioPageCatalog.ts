/** Ordered radio pages accompany the candidate catalog's artist evidence. Local, bounded, unsynced. */
import { CATALOG_MOST, CATALOG_UNSEEN_MS, readPlaylistYtSong } from "@wave/core";
import type { SongRadioPage } from "../playback/songRadioSession.ts";

interface Entry {
  readonly id: string;
  readonly at: number;
  readonly page: SongRadioPage;
}
export const createRadioPageCatalog = (
  storage: {
    readonly read: () => string | null;
    readonly write: (value: string) => void;
  },
  now = Date.now,
) => {
  let entries: Entry[] | null = null;
  const getEntries = (): Entry[] => {
    if (entries !== null) return entries;
    entries = [];
    try {
      const stored: unknown = JSON.parse(storage.read() ?? "[]");
      if (!Array.isArray(stored)) return entries;
      for (const item of stored) {
        if (
          typeof item?.id !== "string" ||
          typeof item.at !== "number" ||
          !Array.isArray(item.page?.songs)
        )
          continue;
        if (item.at <= now() - CATALOG_UNSEEN_MS) continue;
        const songs = item.page.songs.flatMap((value: unknown) => {
          const song = readPlaylistYtSong(JSON.stringify(value));
          return song === null ? [] : [song];
        });
        const continuation =
          typeof item.page.continuation === "string" ? item.page.continuation : null;
        entries.push({ id: item.id, at: item.at, page: { songs, continuation } });
      }
    } catch {
      /* A corrupt cache is empty. */
    }
    return entries;
  };
  return {
    get: (id: string): SongRadioPage | null =>
      getEntries().find((entry) => entry.id === id && entry.at > now() - CATALOG_UNSEEN_MS)?.page ??
      null,
    put: (id: string, page: SongRadioPage): void => {
      let left = CATALOG_MOST;
      entries = [
        {
          id,
          at: now(),
          page: { ...page, songs: page.songs.filter((song) => song.video !== true) },
        },
        ...getEntries().filter((entry) => entry.id !== id && entry.at > now() - CATALOG_UNSEEN_MS),
      ].flatMap((entry) => {
        if (left <= 0) return [];
        const songs = entry.page.songs.slice(0, left);
        left -= songs.length;
        return [{ ...entry, page: { ...entry.page, songs } }];
      });
      try {
        storage.write(JSON.stringify(entries));
      } catch {
        /* Best effort cache. */
      }
    },
  };
};
