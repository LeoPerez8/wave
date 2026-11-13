import type { Lyrics } from "@wave/core";
import * as Effect from "effect/Effect";

import { freeTurn } from "@/lib/backgroundWork";
import { appRuntime } from "./runtime";
import { LibraryStore, type LibraryStoreError } from "./LibraryStore";
import { onLibraryChange } from "./libraryChanges";
import { lyricsEdits } from "./lyricsEdits";
import { readTrackLyrics } from "@/playback/trackLyrics";
import { notifyLyricsSearchIndexChanged } from "./lyricsSearchVersion";

const PAGE_SIZE = 16;
const changed = notifyLyricsSearchIndexChanged;

type LyricsStore = Pick<
  LibraryStore["Service"],
  | "lyricsIndexTarget"
  | "lyricsIndexPage"
  | "staleLyricsIndexPage"
  | "lyricsTrackIdAtPath"
  | "keepLyricsSearchText"
  | "savedLyricsSearchIndexPage"
  | "indexSavedLyricsSearchText"
>;

const plainText = (lyrics: Lyrics): string =>
  lyrics.kind === "synced"
    ? lyrics.lines.map((line) => line.text).join("\n")
    : lyrics.kind === "unsynced"
      ? lyrics.lines.join("\n")
      : "";

const withStore = async <A>(run: (store: LyricsStore) => Effect.Effect<A, LibraryStoreError>) =>
  appRuntime
    .runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        return yield* run(store);
      }),
    )
    .catch(() => undefined);

/** Refreshes one file's index from the native reader, honoring sidecar LRC precedence. */
const refreshTrack = async (trackId: number): Promise<void> => {
  const target = await withStore((store) => store.lyricsIndexTarget(trackId));
  if (target == null) {
    await withStore((store) => store.keepLyricsSearchText(trackId, ""));
    changed();
    return;
  }
  if (target.path === null || !target.hasLyrics) {
    await withStore((store) => store.keepLyricsSearchText(trackId, ""));
    return;
  }
  const lyrics = await readTrackLyrics(target.path);
  await withStore((store) => store.keepLyricsSearchText(trackId, plainText(lyrics)));
  changed();
};

/** Fills the existing Library in short, free-turn slices and refreshes changed files. */
export const startLyricsSearchIndex = (): (() => void) => {
  let stopped = false;
  let working = false;
  let cursor = 0;
  let staleCursor = 0;
  let savedCursor = "";
  let pruneStale = false;
  let runAgain = false;
  const pending = new Set<number>();

  const pump = async (): Promise<void> => {
    if (stopped) return;
    if (working) {
      runAgain = true;
      return;
    }
    working = true;
    try {
      do {
        runAgain = false;
        while (pending.size > 0 && !stopped) {
          const [id] = pending;
          pending.delete(id!);
          await freeTurn();
          await refreshTrack(id!);
        }
        if (stopped) break;
        const savedPage = await withStore((store) =>
          store.savedLyricsSearchIndexPage(savedCursor, PAGE_SIZE),
        );
        if (savedPage == null) break;
        for (const saved of savedPage) {
          if (stopped) break;
          savedCursor = saved.videoId;
          await freeTurn();
          await withStore((store) => store.indexSavedLyricsSearchText(saved));
          changed();
        }
        runAgain ||= savedPage.length === PAGE_SIZE;
        if (runAgain) continue;
        if (pruneStale) {
          const stale = await withStore((store) =>
            store.staleLyricsIndexPage(staleCursor, PAGE_SIZE),
          );
          if (stale == null || stale.length === 0) {
            pruneStale = false;
            staleCursor = 0;
          } else {
            for (const track of stale) {
              if (stopped) break;
              staleCursor = track.id;
              await freeTurn();
              await refreshTrack(track.id);
            }
            runAgain ||= stale.length === PAGE_SIZE;
          }
          if (runAgain) continue;
        }
        const page = await withStore((store) => store.lyricsIndexPage(cursor, PAGE_SIZE));
        if (page == null) break;
        if (page.length === 0) {
          cursor = 0;
          break;
        }
        for (const track of page) {
          if (stopped) break;
          cursor = track.id;
          await freeTurn();
          // Re-read the target before touching disk; the scan may have moved or removed it.
          await refreshTrack(track.id);
        }
        runAgain ||= page.length === PAGE_SIZE;
      } while (runAgain && !stopped);
    } finally {
      working = false;
      if (runAgain && !stopped) void pump();
    }
  };

  const stopLibrary = onLibraryChange((change) => {
    if (change.kind !== "tracks") return;
    if (change.ids === undefined) {
      cursor = 0;
      staleCursor = 0;
      pruneStale = true;
      runAgain = true;
    } else {
      for (const id of change.ids) pending.add(id);
    }
    void pump();
  });
  const stopLyrics = lyricsEdits.subscribe(() => {
    const path = lyricsEdits.get().path;
    if (path === null) return;
    void withStore((store) => store.lyricsTrackIdAtPath(path)).then((id) => {
      if (id !== null && id !== undefined) {
        pending.add(id);
        void pump();
      }
    });
  });
  void pump();
  return () => {
    stopped = true;
    stopLibrary();
    stopLyrics();
  };
};
