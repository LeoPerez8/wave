/** Settings › Lyrics and tags on the desktop (docs/spec.md, Settings): what the window shows. */

import type { Invoke } from "./bridge.ts";
import type { FixSongsResult } from "./songActions.ts";

/** The page's switches, synced with the account. */
export interface LyricsAndTagsSettings {
  /** Fix songs online: Fix Song's lookups, lyrics online and missing songs' covers. */
  readonly fixSongsOnline: boolean;
  readonly downloadArtistPhotos: boolean;
  readonly geniusInsights: boolean;
}

/** How far Fix songs in the whole Library is; total is 0 until its songs are known. */
export interface LibraryFixProgress {
  readonly done: number;
  readonly total: number;
}

export interface LyricsAndTagsView extends LyricsAndTagsSettings {
  /** The whole-Library run, while one goes on. */
  readonly fixRun: LibraryFixProgress | null;
  /** How many artist photos Wave downloaded and keeps. */
  readonly artistPhotos: number;
}

/** Whether [value] is a change the window may ask for. */
export const validLyricsAndTagsChange = (
  value: unknown,
): value is Partial<LyricsAndTagsSettings> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, on]) =>
        (key === "fixSongsOnline" || key === "downloadArtistPhotos" || key === "geniusInsights") &&
        typeof on === "boolean",
    )
  );
};

/** The page's calls to main. */
export interface LyricsAndTagsContract {
  readonly "lyricsAndTags.view": { readonly args: readonly []; readonly result: LyricsAndTagsView };
  readonly "lyricsAndTags.set": {
    readonly args: readonly [change: Partial<LyricsAndTagsSettings>];
    readonly result: LyricsAndTagsView;
  };
  /** Fix songs in the whole Library; answers how the run went once it ends. */
  readonly "lyricsAndTags.fixLibrary": {
    readonly args: readonly [];
    readonly result: FixSongsResult;
  };
  readonly "lyricsAndTags.cancelFix": { readonly args: readonly []; readonly result: void };
  readonly "lyricsAndTags.clearArtistPhotos": {
    readonly args: readonly [];
    readonly result: LyricsAndTagsView;
  };
}

export const LYRICS_AND_TAGS_CALLS = [
  "lyricsAndTags.view",
  "lyricsAndTags.set",
  "lyricsAndTags.fixLibrary",
  "lyricsAndTags.cancelFix",
  "lyricsAndTags.clearArtistPhotos",
] as const satisfies readonly (keyof LyricsAndTagsContract)[];

type Call<C extends keyof LyricsAndTagsContract> = (
  ...args: LyricsAndTagsContract[C]["args"]
) => Promise<LyricsAndTagsContract[C]["result"]>;

/** `window.wave.lyricsAndTags`. */
export interface LyricsAndTagsBridge {
  readonly view: Call<"lyricsAndTags.view">;
  readonly set: Call<"lyricsAndTags.set">;
  readonly fixLibrary: Call<"lyricsAndTags.fixLibrary">;
  readonly cancelFix: Call<"lyricsAndTags.cancelFix">;
  readonly clearArtistPhotos: Call<"lyricsAndTags.clearArtistPhotos">;
}

export const lyricsAndTagsBridge = (invoke: Invoke): LyricsAndTagsBridge => ({
  view: () => invoke("lyricsAndTags.view"),
  set: (change) => invoke("lyricsAndTags.set", change),
  fixLibrary: () => invoke("lyricsAndTags.fixLibrary"),
  cancelFix: () => invoke("lyricsAndTags.cancelFix"),
  clearArtistPhotos: () => invoke("lyricsAndTags.clearArtistPhotos"),
});
