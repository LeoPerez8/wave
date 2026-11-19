import { describePlaylistAdd, favoriteToast, queuedToast, type ActionSurface } from "@wave/core";
import { language, text } from "./text.ts";

/** What queueing, starring or adding to a playlist did, as a Library and a streamed song say it. */
type ToastedResult =
  | { readonly kind: "queued" }
  | { readonly kind: "favorite"; readonly on: boolean; readonly count: number }
  | {
      readonly kind: "playlist";
      readonly name: string;
      readonly added: number;
      readonly alreadyIn: number;
    };

/**
 * The phone's toast for [result]; [queued] is how many songs a queue entry took, placed next
 * when [next].
 */
export const songActionToast = (
  result: ToastedResult,
  next: boolean,
  surface: ActionSurface,
  queued: number,
): string | null => {
  switch (result.kind) {
    case "queued":
      return queuedToast(
        {
          type: next ? "playNext" : "addToQueue",
          trackIds: Array.from({ length: queued }, (_, n) => String(n)),
        },
        undefined,
        text,
      );
    case "favorite":
      return favoriteToast(surface, result.on, result.count, language);
    case "playlist":
      return describePlaylistAdd(result.name, result.added, result.alreadyIn, language);
  }
};
