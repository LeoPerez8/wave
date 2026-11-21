/**
 * A song's Release Date (`window.wave.releaseDates`): the date Wave has for a Library song (its
 * menu's one-song target) or a streamed one (its video id), and the date the owner types.
 */
import type { TypedReleaseDateFields } from "@wave/core";
import type { Invoke } from "./bridge.ts";
import type { SongTarget } from "./songActions.ts";

/** What the dialog shows: the date the song shows and sorts by, and whether the owner typed it. */
export interface ReleaseDateView {
  readonly title: string;
  /** `1985`, `1985-06` or `1985-06-21`; null when none is known. */
  readonly date: string | null;
  readonly typed: boolean;
}

/** A save: done, or why not (Core's `readTypedReleaseDate`; `full`: no room for one more). */
export type ReleaseDateSaved =
  { readonly ok: true } | { readonly ok: false; readonly problem: "empty" | "impossible" | "full" };

export interface ReleaseDateContract {
  readonly "releaseDates.view": {
    readonly args: readonly [song: SongTarget | string];
    readonly result: ReleaseDateView;
  };
  /** Keeps the typed [fields] as the song's date; null clears the typed one. */
  readonly "releaseDates.save": {
    readonly args: readonly [song: SongTarget | string, fields: TypedReleaseDateFields | null];
    readonly result: ReleaseDateSaved;
  };
}

export const RELEASE_DATE_CALLS = ["releaseDates.view", "releaseDates.save"] as const;

export const releaseDateBridge = (invoke: Invoke) => ({
  view: (song: SongTarget | string) => invoke("releaseDates.view", song),
  save: (song: SongTarget | string, fields: TypedReleaseDateFields | null) =>
    invoke("releaseDates.save", song, fields),
});
