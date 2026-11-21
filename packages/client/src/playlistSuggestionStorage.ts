/**
 * What a playlist's suggestions keep on the device, not synced (docs/spec.md, "Saved
 * offers"): each playlist's saved offers, one key a playlist, because opening one reads its
 * own and no others, and each playlist's latest seed draws. Core decides what they hold; the
 * phone keeps them in its key-value store, the desktop in its device settings.
 */
import {
  drawPlaylistSeeds,
  parsePlaylistOfferOrder,
  parsePlaylistSeedHistory,
  playlistSeedHistoryWith,
  storedPlaylistSeedHistory,
  parseSavedPlaylistOffers,
  playlistOfferOrderWith,
  storedPlaylistOfferOrder,
  storedSavedPlaylistOffers,
  type PlaylistRecommendationTrack,
} from "@wave/core";

import type { SongRow } from "./types.ts";

/** A synchronous key-value store on the device; any of its calls may throw. */
export interface SuggestionStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

/** The playlists with saved offers, oldest first; each one's offers are under its id. */
const ORDER = "playlistSuggestions.savedOffers";
const offersKey = (playlistId: number) => `${ORDER}.${playlistId}`;

export interface SavedOffers {
  readonly tracks: readonly PlaylistRecommendationTrack[];
  /** The Library offers' rows, by track id: the section lists them before anything reads. */
  readonly rows: ReadonlyMap<string, SongRow>;
}

type Check = (value: unknown) => boolean;
const isNumber: Check = (value) => typeof value === "number";
const isString: Check = (value) => typeof value === "string";
const orNull =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);

/**
 * Each field a row must hold. A field added to `SongRow` doesn't compile until it's
 * checked here, so a row saved before it reads as not saved: no version to remember.
 * The id is checked against its offer's.
 */
const ROW_FIELDS: { readonly [Field in keyof SongRow]-?: Check } = {
  id: () => true,
  path: orNull(isString),
  title: isString,
  artist: isString,
  album: isString,
  durationMs: isNumber,
  thumbPath: orNull(isString),
  artworkPath: orNull(isString),
  titleSort: isString,
  artistSort: isString,
  albumSort: isString,
  addedAt: isNumber,
  albumId: isNumber,
  artistId: isNumber,
  artistIds: (value) => Array.isArray(value) && value.every(isNumber),
  discNumber: orNull(isNumber),
  trackNumber: orNull(isNumber),
  releaseDate: (value) => value === undefined || value === null || isString(value),
  year: orNull(isNumber),
  genre: orNull(isString),
  hasLyrics: (value) => typeof value === "boolean",
  explicit: (value) => value === "explicit" || value === "clean" || value === "unknown",
};
const ROW_CHECKS = Object.entries(ROW_FIELDS);

const isRowOf = (track: PlaylistRecommendationTrack, row: unknown): row is SongRow => {
  if (typeof row !== "object" || row === null) return false;
  const fields = row as Readonly<Record<string, unknown>>;
  return (
    String(fields["id"]) === track.id && ROW_CHECKS.every(([name, check]) => check(fields[name]))
  );
};

/** Playlist [playlistId]'s saved offers; a Library offer without its row can't be listed. */
export const readSavedOffers = (storage: SuggestionStorage, playlistId: number): SavedOffers => {
  const rows = new Map<string, SongRow>();
  const tracks: PlaylistRecommendationTrack[] = [];
  let text: string | null = null;
  try {
    text = storage.getItem(offersKey(playlistId));
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
  storage: SuggestionStorage,
  playlistId: number,
  offers: readonly PlaylistRecommendationTrack[],
  rowOf: (id: string) => SongRow | undefined,
): void => {
  try {
    storage.setItem(
      offersKey(playlistId),
      storedSavedPlaylistOffers(
        offers.map((track) => {
          const row = track.source === "library" ? rowOf(track.id) : undefined;
          return row === undefined ? { track } : { track, row };
        }),
      ),
    );
    const { order, dropped } = playlistOfferOrderWith(
      parsePlaylistOfferOrder(storage.getItem(ORDER)),
      playlistId,
    );
    storage.setItem(ORDER, storedPlaylistOfferOrder(order));
    for (const old of dropped) storage.removeItem(offersKey(old));
  } catch {
    // Not saved: the next visit shows what it read last, or starts from nothing.
  }
};

/** Each playlist's latest seed draws. */
const SEED_DRAWS = "playlistSuggestions.seedDraws";

/**
 * Draws playlist [playlistId]'s next seeds and saves its recent history so
 * subsequent renewals avoid them while other songs remain.
 */
export const drawSuggestionSeeds = (
  storage: SuggestionStorage,
  playlistId: number,
  playlist: readonly PlaylistRecommendationTrack[],
  random: () => number = Math.random,
): PlaylistRecommendationTrack[] => {
  let history = parsePlaylistSeedHistory(null);
  try {
    history = parsePlaylistSeedHistory(storage.getItem(SEED_DRAWS));
  } catch {
    // Unreadable history: the draw just doesn't avoid earlier seeds.
  }
  const recent = history.get(playlistId) ?? [];
  const draw = drawPlaylistSeeds(playlist, { recent, random });
  if (draw.recent !== recent)
    try {
      storage.setItem(
        SEED_DRAWS,
        storedPlaylistSeedHistory(playlistSeedHistoryWith(history, playlistId, draw.recent)),
      );
    } catch {
      // Not saved: the next visit may draw these seeds again.
    }
  return draw.seeds;
};
