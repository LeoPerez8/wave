import {
  readRecognizeMatch,
  type RecognizeMatch,
  type RecognizeResult,
  type RecognizeTileFavorite,
  type RecognizeTrack,
  type YtSong,
} from "@wave/core";

/** The match notification's star button, native's half (`recognize/RecognizeFavoriteService.kt`). */
export interface RecognizeTileFavoriteNative {
  /** Takes the tap waiting for JS, if one is: its id, the kept match, and the star it asks for. */
  readonly take: () => { readonly tap: number; readonly match: string; readonly on: boolean } | null;
  /** A tap is waiting; returns the unsubscribe. */
  readonly onRequested: (listener: () => void) => () => void;
  /**
   * Tap [tap] on [match] is done: [favorite] is the button as the song's star reads now, or
   * null to leave the button as it is.
   */
  readonly favoriteDone: (
    tap: number,
    match: string,
    favorite: RecognizeTileFavorite | null,
  ) => void;
}

export interface RecognizeTileFavoriteDeps<L extends RecognizeTrack, S extends YtSong> {
  /** The kept match's song as the Library and YT Music have it now. */
  readonly result: (match: RecognizeMatch<S>) => Promise<RecognizeResult<L, S>>;
  /** Stars ([on]) or unstars the result's song, silently. */
  readonly star: (result: RecognizeResult<L, S>, on: boolean) => Promise<void>;
  /** The button for the result, as its star reads now. */
  readonly favorite: (result: RecognizeResult<L, S>) => Promise<RecognizeTileFavorite | null>;
  readonly log: (level: "warn" | "info", line: string) => void;
}

/**
 * Follows the star button of the tile's match notification: a tap stars or unstars the kept
 * match's song without opening Wave, then the button shows the star as it reads afterwards, so a
 * write that failed shows the star as it was. Taps are taken one after another. Returns the
 * unsubscribe.
 */
export const followRecognizeTileFavorites = <L extends RecognizeTrack, S extends YtSong>(
  native: RecognizeTileFavoriteNative,
  deps: RecognizeTileFavoriteDeps<L, S>,
): (() => void) => {
  let turn = Promise.resolve();

  const answer = async (kept: string, on: boolean): Promise<RecognizeTileFavorite | null> => {
    const match = readRecognizeMatch<S>(kept);
    if (match === null) return null;
    const result = await deps.result(match);
    await deps.star(result, on).catch(() => {
      deps.log("warn", "Recognize tile: favorite write failed");
    });
    return deps.favorite(result);
  };

  const receive = (): void => {
    for (let request = native.take(); request !== null; request = native.take()) {
      const { tap, match, on } = request;
      turn = turn
        .then(() => answer(match, on))
        .catch(() => null)
        .then((favorite) => native.favoriteDone(tap, match, favorite));
    }
  };

  const stop = native.onRequested(receive);
  receive();
  return stop;
};
