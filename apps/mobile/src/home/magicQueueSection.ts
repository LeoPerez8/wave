/**
 * Home's Magic Queue section (docs/spec.md, Magic Queue): nine of the
 * Library's songs to start a Magic Queue from with one tap. Which songs,
 * when they change and what a pull brings are Core's (`magicQueuePicks`,
 * `refreshedMagicQueuePicks`, `undoneMagicQueueRefresh`), weighed by the
 * taste profile (`tasteProfileNow`); this keeps what the section shows on
 * the phone and picks again when it's due (a new day, a song gone).
 */
import {
  magicLibrarySongs,
  magicQueuePicks,
  magicQueuePicksDue,
  parseMagicQueuePicks,
  refreshedMagicQueuePicks,
  storedMagicQueuePicks,
  undoneMagicQueueRefresh,
  type MagicQueuePicks,
  type MagicSong,
  type TasteProfile,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { persistedSetting } from "@/lib/persistedSetting";
import { LibraryStore, songHasFile, type PlayableSongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { libraryQuery, useLibraryQuery } from "@/library/sharedQueries";
import { showError } from "@/overlay/alert";
import { showToast } from "@/overlay/toast";
import { startMagicQueue } from "@/playback/MagicQueue";
import { tasteProfileNow } from "@/playback/TasteProfile";

/** What the section shows, kept on this phone (not synced). */
const saved = persistedSetting<MagicQueuePicks | null>({
  key: "home.magicQueuePicks",
  read: parseMagicQueuePicks,
  write: (picks) => (picks === null ? null : storedMagicQueuePicks(picks)),
});

/** The Library's songs that can play: what the section picks from, and shows. */
interface MagicQueueLibrary {
  /** By queue track id. */
  readonly songs: ReadonlyMap<string, PlayableSongRow>;
  /** As the Magic Queue and the taste profile weigh them. */
  readonly magic: readonly MagicSong[];
}

const MAGIC_QUEUE_LIBRARY = libraryQuery<MagicQueueLibrary>(
  "magicQueueSection",
  { tracks: true },
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const songs = (yield* store.listSongs).filter(songHasFile);
    const toMagicSong = magicLibrarySongs(yield* store.listArtists);
    return {
      songs: new Map(songs.map((song) => [String(song.id), song])),
      magic: songs.map(toMagicSong),
    };
  }),
);

/** A pick under way: Home coming back into focus, or a pull, meanwhile starts no other. */
const picking = makeExternalStore(false);

/** Runs [pick] with the taste profile, once no other pick is under way. */
const pickWithTaste = (pick: (taste: TasteProfile | null, now: number) => void): void => {
  if (picking.get()) return;
  picking.set(true);
  void appRuntime
    .runPromise(tasteProfileNow)
    .then((taste) => pick(taste, Date.now()))
    .catch(() => {
      // Best effort: what the section shows stays until the next try.
    })
    .finally(() => {
      picking.set(false);
    });
};

/** Picks what the section shows when it's due (Core's `magicQueuePicksDue`). */
const update = (library: MagicQueueLibrary): void => {
  if (!magicQueuePicksDue(saved.get(), library.magic, Date.now())) return;
  pickWithTaste((taste, now) => {
    saved.set(magicQueuePicks(saved.get(), library.magic, { now, taste, random: Math.random }));
  });
};

/** The toast after a pull brought other songs; its Undo puts the previous ones back. */
const NEW_SONGS = "New songs";

/**
 * Other songs for the section, now (the owner pulled its carousel past its
 * start): ones it didn't show today where others are left, with a "New
 * songs" toast whose Undo puts the previous ones back while it shows.
 */
const refresh = (library: MagicQueueLibrary): void => {
  pickWithTaste((taste, now) => {
    const previous = saved.get();
    const picked = { now, taste, random: Math.random };
    const refreshed =
      previous === null
        ? magicQueuePicks(null, library.magic, picked)
        : refreshedMagicQueuePicks(previous, library.magic, picked);
    saved.set(refreshed);
    if (previous === null) return;
    void showToast(NEW_SONGS, {
      label: "Undo",
      run: () => {
        // Another pick saved since: Undo would throw its songs away.
        if (saved.get() !== refreshed) return;
        saved.set(undoneMagicQueueRefresh(previous, refreshed));
      },
    });
  });
};

/** What the section shows, and what it can do. */
export interface MagicQueueSection {
  /** Its songs, in order: those of the Library that can play. */
  readonly songs: readonly PlayableSongRow[];
  /** A pick is under way: a pull does nothing meanwhile. */
  readonly picking: boolean;
  /** Brings other songs (a pull past the carousel's start), with Undo. */
  readonly refresh: () => void;
}

/**
 * What Home's Magic Queue section shows, or null until the Library is read.
 * Each time Home comes into focus, and as the Library changes, it picks its
 * songs again when they're due: a new list each day, a song gone replaced.
 */
export const useMagicQueueSection = (): MagicQueueSection | null => {
  const library = useLibraryQuery<MagicQueueLibrary | null>(MAGIC_QUEUE_LIBRARY, null);
  const picks = saved.useValue();
  const busy = useSyncExternalStore(picking.subscribe, picking.get);
  useFocusEffect(
    useCallback(() => {
      if (library !== null) update(library);
    }, [library]),
  );
  return useMemo(
    () =>
      library === null
        ? null
        : {
            songs: (picks?.trackIds ?? []).flatMap((id) => library.songs.get(id) ?? []),
            picking: busy,
            refresh: () => refresh(library),
          },
    [library, picks, busy],
  );
};

/**
 * Starts a Magic Queue from [song] (a tap on its tile), as its long-press
 * menu's Magic Queue does: the queue's "New queue playing" toast offers Undo.
 */
export const startMagicQueueFrom = (song: PlayableSongRow): void => {
  appRuntime
    .runPromise(startMagicQueue({ kind: "track", id: String(song.id), title: song.title }, [song]))
    .catch((error: unknown) => showError("Couldn't start the Magic Queue", error));
};
