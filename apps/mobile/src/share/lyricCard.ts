import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";

/** What a lyrics card shows (docs/spec.md, "Sharing lyrics"). */
export interface LyricCardContent {
  readonly title: string;
  readonly artist: string;
  /** File URI of the cover; absent for a song without artwork. */
  readonly artworkUri: string | undefined;
  /** The selected lines, in order (Core's `sharedLyricLines`). */
  readonly lines: readonly string[];
  /** The colours a tap cycles through, the first to start with (Core's `lyricCardColours`). */
  readonly colours: readonly string[];
}

/** The card being previewed over Now Playing, or null. */
const previewed = makeExternalStore<LyricCardContent | null>(null);

/** Opens the card's preview over Now Playing (the lyrics' Next). */
export const openLyricCard = (content: LyricCardContent): void => previewed.set(content);

/** Closes the preview, back to picking lines. */
export const closeLyricCard = (): void => previewed.set(null);

export const useLyricCard = (): LyricCardContent | null =>
  useSyncExternalStore(previewed.subscribe, previewed.get);

export const useLyricCardShown = (): boolean =>
  useSyncExternalStore(previewed.subscribe, () => previewed.get() !== null);
