/**
 * The suggestions a playlist keeps for its next visit (docs/spec.md, "Saved
 * offers"): what a renewal saves, what a visit shows of it, and what leaves it.
 */
import { finishSteps } from "./buildSteps.ts";
import {
  PLAYLIST_SHOWN_OFFERS,
  playlistOfferFits,
  playlistRecordingMatch,
  playlistRecordingMatchSteps,
  type PlaylistRecommendationSources,
  type PlaylistRecommendationTrack,
} from "./playlistRecommendations.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";

/** How many offers a playlist saves: the five it shows, and 15 spares for those that leave. */
export const PLAYLIST_SAVED_OFFERS = 20;

/** How many playlists keep their offers: the latest ones saved. */
export const PLAYLIST_SAVED_PLAYLISTS = 200;

/** The first offers of [offers] that fit together, a section's slots at most: what it holds. */
const fitting = (offers: readonly PlaylistRecommendationTrack[]) => {
  const shown: PlaylistRecommendationTrack[] = [];
  for (const offer of offers) {
    if (shown.length === PLAYLIST_SHOWN_OFFERS) break;
    if (playlistOfferFits(shown)(offer)) shown.push(offer);
  }
  return shown;
};

/**
 * What to save after a renewal ranked [ranked]: the five it would show, then
 * the next ones as spares, in ranked order. A renewal made offline, or finding
 * nothing, leaves [saved] be: the streamed offers it can't see stay hidden, not lost.
 */
export const playlistOffersToSave = (
  saved: readonly PlaylistRecommendationTrack[],
  ranked: readonly PlaylistRecommendationTrack[],
  { online }: { readonly online: boolean },
): readonly PlaylistRecommendationTrack[] => {
  if (ranked.length === 0 || (!online && saved.length > 0)) return saved;
  const kept = new Set(fitting(ranked));
  let spares = PLAYLIST_SAVED_OFFERS - kept.size;
  return ranked.filter((offer) => {
    if (kept.has(offer)) return true;
    return spares-- > 0;
  });
};

/** Whether a visit may show saved [offer]: a song with a file and, offline, not a streamed one. */
const showable = (offer: PlaylistRecommendationTrack, online: boolean) =>
  offer.available !== false && (online || offer.source !== "stream");

/**
 * The offers a visit shows of [saved], in their saved order. Offline, the
 * streamed ones stay hidden: they're still saved for when the phone is back online.
 */
export const playlistOffersToShow = (
  saved: readonly PlaylistRecommendationTrack[],
  { online }: { readonly online: boolean },
): PlaylistRecommendationTrack[] => fitting(saved.filter((offer) => showable(offer, online)));

/** The saved offer of [saved] that may join the [shown] ones, if any is left. */
export const playlistSpareOffer = (
  saved: readonly PlaylistRecommendationTrack[],
  shown: readonly PlaylistRecommendationTrack[],
  { online }: { readonly online: boolean },
): PlaylistRecommendationTrack | undefined => {
  const fits = playlistOfferFits(shown);
  return saved.find((offer) => showable(offer, online) && fits(offer));
};

/** [saved] without [songs], any recording of them: they were added, dismissed or left. */
export const playlistOffersWithout = (
  saved: readonly PlaylistRecommendationTrack[],
  songs: readonly PlaylistRecommendationTrack[],
): readonly PlaylistRecommendationTrack[] => {
  const left = playlistRecordingMatch(songs);
  return saved.filter((offer) => left(offer) === null);
};

/**
 * Whether an offer can no longer stand, by a fresh read: [playlist] holds any
 * recording of it, the playlist dismissed it and hasn't accepted it since, or
 * it's a Library song whose file is gone. Before its first read the Library is
 * empty, and that says nothing about a Library song.
 */
export function* playlistOfferGoneSteps(
  playlist: readonly PlaylistRecommendationTrack[],
  { library, feedback = [] }: Pick<PlaylistRecommendationSources, "library" | "feedback">,
): Generator<void, (offer: PlaylistRecommendationTrack) => boolean> {
  const held = yield* playlistRecordingMatchSteps(playlist);
  const accepted = playlistRecordingMatch(
    feedback.flatMap((signal) => (signal.value === 1 ? [signal.track] : [])),
  );
  const dismissed = playlistRecordingMatch(
    feedback.flatMap((signal) =>
      signal.value === -1 && accepted(signal.track) === null ? [signal.track] : [],
    ),
  );
  const withFile = new Set<string>();
  for (const song of library) {
    if (song.available !== false) withFile.add(song.id);
    yield;
  }
  return (offer) => {
    if (held(offer) !== null || dismissed(offer) !== null) return true;
    return offer.source === "library" && library.length > 0 && !withFile.has(offer.id);
  };
}

/** `playlistOfferGoneSteps` all at once. */
export const playlistOfferGone = (
  playlist: readonly PlaylistRecommendationTrack[],
  sources: Pick<PlaylistRecommendationSources, "library" | "feedback">,
): ((offer: PlaylistRecommendationTrack) => boolean) =>
  finishSteps(playlistOfferGoneSteps(playlist, sources));

/**
 * Which of [offers] are among a playlist's [entries], by Library id or video id: cheap
 * enough for when they've just been read, on a playlist of thousands. It walks the entries
 * once, copying none of them, and knows only [offers]. Another recording of an offer waits
 * for `playlistOfferGone`, whose index a long playlist needs turns for.
 */
export const playlistOfferHeld = <Entry>(
  offers: readonly PlaylistRecommendationTrack[],
  entries: readonly Entry[],
  idOf: (entry: Entry) => string | undefined,
  videoIdOf: (entry: Entry) => string | undefined,
): ((offer: PlaylistRecommendationTrack) => boolean) => {
  const ids = new Set(offers.map((offer) => offer.id));
  const videos = new Set(offers.map((offer) => offer.videoId));
  videos.delete("");
  const heldIds = new Set<string>();
  const heldVideos = new Set<string>();
  for (const entry of entries) {
    const id = idOf(entry);
    if (id !== undefined && ids.has(id)) heldIds.add(id);
    const videoId = videoIdOf(entry);
    if (videoId !== undefined && videos.has(videoId)) heldVideos.add(videoId);
  }
  return (offer) => heldIds.has(offer.id) || heldVideos.has(offer.videoId);
};

/**
 * A saved offer: its track and, for a Library song, the row its section lists,
 * which only the app can read.
 */
export interface SavedPlaylistOffer {
  readonly track: PlaylistRecommendationTrack;
  readonly row?: unknown;
}

/** [offers] as text, for `parseSavedPlaylistOffers`. */
export const storedSavedPlaylistOffers = (offers: readonly SavedPlaylistOffer[]): string =>
  JSON.stringify(offers);

type Check = (value: unknown) => boolean;
const isString: Check = (value) => typeof value === "string";
const orNull =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);

/**
 * Each field a saved track must hold. One added to `YtAlbumSong` doesn't compile until
 * it's checked here, so a track saved before it reads as not saved.
 */
const TRACK_FIELDS: { readonly [Field in keyof YtAlbumSong]-?: Check } & {
  readonly id: Check;
  readonly source: Check;
} = {
  id: isString,
  source: (value) => value === "library" || value === "stream",
  videoId: isString,
  title: isString,
  artists: (value) => Array.isArray(value) && value.every(isString),
  album: orNull(isString),
  albumId: orNull(isString),
  durationMs: orNull((value) => typeof value === "number"),
  artworkUrl: orNull(isString),
  explicit: (value) => typeof value === "boolean",
};
const TRACK_CHECKS = Object.entries(TRACK_FIELDS);

const isTrack = (value: unknown): value is PlaylistRecommendationTrack => {
  if (typeof value !== "object" || value === null) return false;
  const track = value as Readonly<Record<string, unknown>>;
  return TRACK_CHECKS.every(([name, check]) => check(track[name]));
};

/** The offers [text] stored; anything unreadable reads as not saved. */
export const parseSavedPlaylistOffers = (text: string | null): readonly SavedPlaylistOffer[] => {
  if (text === null) return [];
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry: unknown): entry is SavedPlaylistOffer =>
        typeof entry === "object" &&
        entry !== null &&
        isTrack((entry as Record<string, unknown>)["track"]),
    );
  } catch {
    return [];
  }
};

/**
 * [order] (the playlists with saved offers, oldest first) with playlist [id] as
 * the latest, and those it pushes out, whose offers go.
 */
export const playlistOfferOrderWith = (
  order: readonly number[],
  id: number,
): { readonly order: readonly number[]; readonly dropped: readonly number[] } => {
  const next = [...order.filter((other) => other !== id), id];
  const over = Math.max(0, next.length - PLAYLIST_SAVED_PLAYLISTS);
  return { order: next.slice(over), dropped: next.slice(0, over) };
};

/** [order] as text, for `parsePlaylistOfferOrder`. */
export const storedPlaylistOfferOrder = (order: readonly number[]): string => JSON.stringify(order);

/** The order [text] stored; anything unreadable reads as none. */
export const parsePlaylistOfferOrder = (text: string | null): readonly number[] => {
  if (text === null) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) && value.every((id) => Number.isInteger(id))
      ? (value as number[])
      : [];
  } catch {
    return [];
  }
};
