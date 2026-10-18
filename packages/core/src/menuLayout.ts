/**
 * How a long-press menu lays out what it offers: the play actions as one row
 * of cards at its top, the rest as its list under them. Each menu's entries
 * come from its own planner (`itemActions`, `ytSongActions`,
 * `discoverMixActions`…); this decides which become cards.
 */

import { ITEM_ACTION_LABELS, type ItemKind } from "./itemActions.ts";

/** A play action shown as a card at the top of a menu, in this order. */
export type PlayCard = "play" | "playNext" | "addToQueue";

/** What a menu's Shuffle row does: plays the collection shuffled, as its page's Shuffle does. */
export type PlayAction = PlayCard | "shuffle";

/** What each play action says, on its card or row. */
export const PLAY_ACTION_LABELS: { readonly [A in PlayAction]: string } = {
  play: "Play",
  playNext: ITEM_ACTION_LABELS.playNext,
  addToQueue: ITEM_ACTION_LABELS.addToQueue,
  shuffle: "Shuffle",
};

/**
 * What a long-press menu is about: a Library item (`ItemKind`; a track
 * covers the Library's songs and a playlist's unsearched entries), a
 * Discover mix, a YT Music album, artist or song, or a playlist's
 * unavailable entry.
 */
export type MenuSubject =
  ItemKind | "discoverMix" | "ytAlbum" | "ytArtist" | "ytSong" | "unavailableEntry";

/** A menu's cards, then its list (Shuffle first on a collection's). */
export interface MenuLayout<E> {
  readonly cards: readonly PlayCard[];
  readonly list: readonly (E | { readonly action: "shuffle" })[];
}

/** What plays as a whole from its menu: Play and Shuffle, besides the queue. */
const COLLECTIONS: ReadonlySet<MenuSubject> = new Set<MenuSubject>([
  "album",
  "artist",
  "playlist",
  "genre",
  "section",
  "discoverMix",
  "ytAlbum",
  "ytArtist",
]);

const QUEUE_CARDS = ["playNext", "addToQueue"] as const;

const isQueueEntry = (entry: { readonly action: string }): boolean =>
  entry.action === "playNext" || entry.action === "addToQueue";

/**
 * Lays out [subject]'s menu from its [entries]: Play Next and Add to Queue
 * leave the list for cards. A collection has Play, Play Next and Add to
 * Queue cards and Shuffle first in its list, unless it's [empty] (no songs
 * to play, as a YT Music artist's page can be): then neither. A song (a tap
 * already plays it) has no Play card, and only the queue cards its entries
 * offer (none for a missing song, or an unavailable entry).
 */
export const menuLayout = <E extends { readonly action: string }>(
  subject: MenuSubject,
  entries: readonly E[],
  { empty = false }: { readonly empty?: boolean } = {},
): MenuLayout<E> => {
  const list = entries.filter((entry) => !isQueueEntry(entry));
  if (empty) return { cards: [], list };
  if (COLLECTIONS.has(subject))
    return { cards: ["play", ...QUEUE_CARDS], list: [{ action: "shuffle" }, ...list] };
  return {
    cards: QUEUE_CARDS.filter((card) => entries.some((entry) => entry.action === card)),
    list,
  };
};
