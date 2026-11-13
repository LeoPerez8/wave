/**
 * Keeps the local lyrics Search index in step with the Library: fills it in
 * short slices, refreshes changed files and drops songs that lost their file or
 * lyrics. Its store, file reader and turns are injected, so it runs in tests.
 */
import type { Lyrics } from "@wave/core";
import type * as Effect from "effect/Effect";

import type { LibraryStore, LibraryStoreError } from "./LibraryStore.ts";

const PAGE_SIZE = 16;

export type LyricsIndexStore = Pick<
  LibraryStore["Service"],
  | "lyricsIndexTarget"
  | "lyricsIndexPage"
  | "staleLyricsIndexPage"
  | "keepLyricsSearchText"
  | "savedLyricsSearchIndexPage"
  | "indexSavedLyricsSearchText"
>;

export interface LyricsSearchIndexerDeps {
  /** Runs one store call; undefined when it failed. */
  readonly withStore: <A>(
    run: (store: LyricsIndexStore) => Effect.Effect<A, LibraryStoreError>,
  ) => Promise<A | undefined>;
  /** A file's lyrics, embedded or sidecar; none when it can't be read. */
  readonly readLyrics: (path: string) => Promise<Lyrics>;
  /** Tells Search the index changed. */
  readonly changed: () => void;
  /** Waits for a free turn before each file. */
  readonly freeTurn: () => Promise<void>;
}

export interface LyricsSearchIndexer {
  /** Fills the index, or carries on filling it; settles when this pass is done. */
  readonly fill: () => Promise<void>;
  /** Tracks [ids] changed, or the whole Library when they're unknown. */
  readonly tracksChanged: (ids?: readonly number[]) => Promise<void>;
  readonly stop: () => void;
}

const plainText = (lyrics: Lyrics): string =>
  lyrics.kind === "synced"
    ? lyrics.lines.map((line) => line.text).join("\n")
    : lyrics.kind === "unsynced"
      ? lyrics.lines.join("\n")
      : "";

export const createLyricsSearchIndexer = ({
  withStore,
  readLyrics,
  changed,
  freeTurn,
}: LyricsSearchIndexerDeps): LyricsSearchIndexer => {
  let stopped = false;
  let running: Promise<void> | null = null;
  let cursor = 0;
  let staleCursor = 0;
  let savedCursor = "";
  let pruneStale = false;
  let runAgain = false;
  const pending = new Set<number>();

  /** Refreshes one file's index from the reader, which honours sidecar LRC precedence. */
  const refreshTrack = async (trackId: number): Promise<void> => {
    const target = await withStore((store) => store.lyricsIndexTarget(trackId));
    if (target == null || target.path === null || !target.hasLyrics) {
      await withStore((store) => store.keepLyricsSearchText(trackId, null));
      changed();
      return;
    }
    const lyrics = await readLyrics(target.path);
    await withStore((store) => store.keepLyricsSearchText(trackId, plainText(lyrics)));
    changed();
  };

  const work = async (): Promise<void> => {
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
  };

  const fill = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running !== null) {
      runAgain = true;
      return running;
    }
    running = work().finally(() => {
      running = null;
      if (runAgain && !stopped) void fill();
    });
    return running;
  };

  return {
    fill,
    tracksChanged: (ids) => {
      if (ids === undefined) {
        cursor = 0;
        staleCursor = 0;
        pruneStale = true;
        runAgain = true;
      } else {
        for (const id of ids) pending.add(id);
      }
      return fill();
    },
    stop: () => {
      stopped = true;
    },
  };
};
