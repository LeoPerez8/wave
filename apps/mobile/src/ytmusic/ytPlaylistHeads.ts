import { Storage } from "expo-sqlite/kv-store";

import type { YtListHead } from "./routes";

const KEY = "ytmusic.playlistHeads";
/** How many playlists' heads are kept, the latest opened first. */
const KEPT = 50;

let heads: Readonly<Record<string, YtListHead>> | undefined;

const kept = (): Readonly<Record<string, YtListHead>> => {
  if (heads !== undefined) return heads;
  try {
    const stored = Storage.getItemSync(KEY);
    heads = stored === null ? {} : (JSON.parse(stored) as Record<string, YtListHead>);
  } catch {
    heads = {};
  }
  return heads;
};

/**
 * The title, maker and cover of the YouTube Music playlist [playlistId] as
 * its page was last read, which Recently played's card for it shows (the play
 * history keeps only its id).
 */
export const keptYtPlaylistHead = (playlistId: string): YtListHead | undefined =>
  kept()[playlistId];

/** Keeps [head] for the YouTube Music playlist [playlistId] opened, dropping the oldest past `KEPT`. */
export const keepYtPlaylistHead = (playlistId: string, head: YtListHead): void => {
  if (head.title === "") return;
  const next: Record<string, YtListHead> = { [playlistId]: head };
  for (const [id, other] of Object.entries(kept())) {
    if (Object.keys(next).length >= KEPT) break;
    if (id !== playlistId) next[id] = other;
  }
  heads = next;
  try {
    Storage.setItemSync(KEY, JSON.stringify(next));
  } catch {
    // Kept for this run only; the card falls back to its word for a playlist.
  }
};
