/**
 * Where each playlist's saved suggestions live (docs/spec.md, "Saved offers"): on the
 * phone, not synced. One key a playlist, because opening one reads its own and no others;
 * Core decides what they hold.
 */
import {
  parsePlaylistOfferOrder,
  parseSavedPlaylistOffers,
  playlistOfferOrderWith,
  storedPlaylistOfferOrder,
  storedSavedPlaylistOffers,
  type PlaylistRecommendationTrack,
} from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";

import type { SongRow } from "./LibraryStore";

/** The playlists with saved offers, oldest first; each one's offers are under its id. */
const ORDER = "playlistSuggestions.savedOffers";
const offersKey = (playlistId: number) => `${ORDER}.${playlistId}`;

export interface SavedOffers {
  readonly tracks: readonly PlaylistRecommendationTrack[];
  /** The Library offers' rows, by track id: the section lists them before anything reads. */
  readonly rows: ReadonlyMap<string, SongRow>;
}

const isRowOf = (track: PlaylistRecommendationTrack, row: unknown): row is SongRow => {
  if (typeof row !== "object" || row === null) return false;
  const { id, title } = row as { readonly id?: unknown; readonly title?: unknown };
  return String(id) === track.id && typeof title === "string";
};

/** Playlist [playlistId]'s saved offers; a Library offer without its row can't be listed. */
export const readSavedOffers = (playlistId: number): SavedOffers => {
  const rows = new Map<string, SongRow>();
  const tracks: PlaylistRecommendationTrack[] = [];
  let text: string | null = null;
  try {
    text = Storage.getItemSync(offersKey(playlistId));
  } catch {
    // Unreadable: the same as nothing saved.
  }
  for (const { track, row } of parseSavedPlaylistOffers(text)) {
    if (track.source === "library") {
      if (!isRowOf(track, row)) continue;
      rows.set(track.id, row);
    }
    tracks.push(track);
  }
  return { tracks, rows };
};

/** Saves [offers] as playlist [playlistId]'s, its latest; the oldest past the limit go. */
export const writeSavedOffers = (
  playlistId: number,
  offers: readonly PlaylistRecommendationTrack[],
  rowOf: (id: string) => SongRow | undefined,
): void => {
  try {
    Storage.setItemSync(
      offersKey(playlistId),
      storedSavedPlaylistOffers(
        offers.map((track) => {
          const row = track.source === "library" ? rowOf(track.id) : undefined;
          return row === undefined ? { track } : { track, row };
        }),
      ),
    );
    const { order, dropped } = playlistOfferOrderWith(
      parsePlaylistOfferOrder(Storage.getItemSync(ORDER)),
      playlistId,
    );
    Storage.setItemSync(ORDER, storedPlaylistOfferOrder(order));
    for (const old of dropped) Storage.removeItemSync(offersKey(old));
  } catch {
    // Not saved: the next visit shows what it read last, or starts from nothing.
  }
};
