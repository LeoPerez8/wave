import * as Effect from "effect/Effect";

import { freeTurn } from "@/lib/backgroundWork";
import { appRuntime } from "./runtime";
import { LibraryStore } from "./LibraryStore";
import { onLibraryChange } from "./libraryChanges";
import { lyricsEdits } from "./lyricsEdits";
import { createLyricsSearchIndexer, type LyricsSearchIndexerDeps } from "./lyricsSearchIndexer";
import { readTrackLyrics } from "@/playback/trackLyrics";
import { notifyLyricsSearchIndexChanged } from "./lyricsSearchVersion";

const withStore: LyricsSearchIndexerDeps["withStore"] = (run) =>
  appRuntime
    .runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        return yield* run(store);
      }),
    )
    .catch(() => undefined);

/** Fills the existing Library in short, free-turn slices and refreshes changed files. */
export const startLyricsSearchIndex = (): (() => void) => {
  const indexer = createLyricsSearchIndexer({
    withStore,
    readLyrics: readTrackLyrics,
    changed: notifyLyricsSearchIndexChanged,
    freeTurn,
  });
  const stopLibrary = onLibraryChange((change) => {
    if (change.kind !== "tracks") return;
    void indexer.tracksChanged(change.ids);
  });
  const stopLyrics = lyricsEdits.subscribe(() => {
    const path = lyricsEdits.get().path;
    if (path === null) return;
    void appRuntime
      .runPromise(Effect.flatMap(LibraryStore, (store) => store.lyricsTrackIdAtPath(path)))
      .then((id) => {
        if (id !== null) void indexer.tracksChanged([id]);
      })
      .catch(() => undefined);
  });
  void indexer.fill();
  return () => {
    indexer.stop();
    stopLibrary();
    stopLyrics();
  };
};
