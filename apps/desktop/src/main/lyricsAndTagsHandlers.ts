/** Main's side of `window.wave.lyricsAndTags` (Settings › Lyrics and tags). */
import { Database } from "@wave/client";
import * as Effect from "effect/Effect";

import type { BridgeContract } from "../shared/bridge.ts";
import {
  validLyricsAndTagsChange,
  type LYRICS_AND_TAGS_CALLS,
  type LyricsAndTagsView,
} from "../shared/lyricsAndTags.ts";
import { Account } from "./account/accountLayer.ts";
import { Downloads } from "./downloads/downloadsLayer.ts";
import { DesktopLibrary } from "./library/library.ts";
import { readLyricsAndTags, saveLyricsAndTags } from "./library/lyricsAndTags.ts";
import { GeniusLyricsSearch } from "./lyrics/geniusLyricsSearchLayer.ts";

type LyricsAndTagsCall = (typeof LYRICS_AND_TAGS_CALLS)[number];

export type LyricsAndTagsHandlers = {
  readonly [C in LyricsAndTagsCall]: (
    args: readonly unknown[],
  ) => Effect.Effect<
    BridgeContract[C]["result"],
    unknown,
    Account | Database | DesktopLibrary | Downloads | GeniusLyricsSearch
  >;
};

const view = Effect.gen(function* () {
  const db = yield* Database;
  const library = yield* DesktopLibrary;
  const downloads = yield* Downloads;
  const artistPhotos = yield* Effect.tryPromise({
    try: async () => (await library.cover?.artistPhotos.count()) ?? 0,
    catch: (error) => error,
  });
  return {
    ...readLyricsAndTags(db),
    fixRun: downloads.libraryFix.progress(),
    artistPhotos,
  } satisfies LyricsAndTagsView;
});

export const lyricsAndTagsHandlers: LyricsAndTagsHandlers = {
  "lyricsAndTags.view": () => view,
  "lyricsAndTags.set": ([change]) =>
    validLyricsAndTagsChange(change)
      ? Effect.gen(function* () {
          const saved = saveLyricsAndTags(yield* Database, change, Date.now());
          // Off means no more requests, the whole-Library run's too.
          if (!saved.fixSongsOnline) (yield* Downloads).libraryFix.cancel();
          if (!saved.geniusInsights) (yield* GeniusLyricsSearch).cancel();
          (yield* Account).settingsEdited();
          return yield* view;
        })
      : Effect.fail(new Error("Refused lyricsAndTags.set: invalid settings")),
  "lyricsAndTags.fixLibrary": () =>
    Effect.gen(function* () {
      const downloads = yield* Downloads;
      return yield* Effect.tryPromise({
        try: () => downloads.libraryFix.start(),
        catch: (error) => error,
      });
    }),
  "lyricsAndTags.cancelFix": () =>
    Effect.map(Downloads, (downloads) => downloads.libraryFix.cancel()),
  "lyricsAndTags.clearArtistPhotos": () =>
    Effect.gen(function* () {
      const library = yield* DesktopLibrary;
      yield* Effect.tryPromise({
        try: async () => library.cover?.artistPhotos.clear(),
        catch: (error) => error,
      });
      return yield* view;
    }),
};
