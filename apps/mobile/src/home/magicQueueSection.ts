/**
 * Home's Magic Queue section (docs/spec.md, Magic Queue): nine of the
 * Library's songs to start a Magic Queue from with one tap. Which songs,
 * when they change and what a pull brings are Core's (`magicQueuePicks`,
 * `magicQueuePicksSteps`, `undoneMagicQueueRefresh`), weighed by the taste
 * profile (`tasteProfileForLibrary`); this keeps what the section shows on
 * the phone, reads only those songs, and picks again when it's due (a new
 * day, a song gone) once Home has settled.
 */
import {
  MAGIC_QUEUE_PICKS,
  parseMagicQueuePicks,
  storedMagicQueuePicks,
  undoneMagicQueueRefresh,
  type MagicQueuePicks,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { freeTurnEffect } from "@/lib/backgroundWork";
import { makeExternalStore } from "@/lib/externalStore";
import { persistedSetting } from "@/lib/persistedSetting";
import { useScreenSettled } from "@/lib/screenTiming";
import { LibraryStore, type PlayableSongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { libraryQuery, useLibraryQuery } from "@/library/sharedQueries";
import { showError } from "@/overlay/alert";
import { showToast } from "@/overlay/toast";
import { startMagicQueue } from "@/playback/MagicQueue";
import { tasteProfileForLibrary } from "@/playback/TasteProfile";

import { buildHomeMagicQueue, homeMagicQueueDue } from "./magicQueueJob";
import { magicQueueRead, magicQueueGrowthRead } from "./magicQueueRead";

/** What the section shows, kept on this phone (not synced). */
const saved = persistedSetting<MagicQueuePicks | null>({
  key: "home.magicQueuePicks",
  read: parseMagicQueuePicks,
  write: (picks) => (picks === null ? null : storedMagicQueuePicks(picks)),
});

/** A pick under way: a pull, or Home's due pick, meanwhile starts no other. */
const picking = makeExternalStore(false);
let active = false;
/** Stops Home's due pick under way (Home left, or not settled): a pull's goes on. */
let cancelDue: (() => void) | undefined;

/**
 * Picks the section's songs as background work on free turns: what it shows
 * stays until the new list is saved. A pull ([refresh]) brings other songs,
 * with a "New songs" toast whose Undo puts the previous ones back.
 */
const pick = (refresh: boolean): void => {
  if (active) return;
  const previous = saved.get();
  const controller = new AbortController();
  active = true;
  picking.set(true);
  const finish = () => {
    if (!active) return;
    active = false;
    cancelDue = undefined;
    picking.set(false);
  };
  const job = Effect.gen(function* () {
    return yield* buildHomeMagicQueue(yield* LibraryStore, previous, {
      now: Date.now(),
      random: Math.random,
      turn: freeTurnEffect,
      taste: tasteProfileForLibrary,
      refresh,
    });
  });
  void appRuntime
    .runPromise(job, { signal: controller.signal })
    .then((picks) => {
      // Another pick saved since: this one would throw its songs away.
      if (controller.signal.aborted || saved.get() !== previous) return;
      saved.set(picks);
      if (!refresh || previous === null) return;
      void showToast("New songs", {
        label: "Undo",
        run: () => {
          if (saved.get() === picks) saved.set(undoneMagicQueueRefresh(previous, picks));
        },
      });
    })
    .catch(() => {
      // Best effort: what the section shows stays until the next try.
    })
    .finally(() => {
      if (!controller.signal.aborted) finish();
    });
  if (!refresh)
    cancelDue = () => {
      finish();
      controller.abort();
    };
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
 * What Home's Magic Queue section shows, or null until its songs are read:
 * only the songs picked, by id, following changes to those songs alone. Once
 * Home has settled it picks them again when they're due (a new list each day,
 * a song gone replaced, a short list as the Library grows), as background
 * work; the previous songs show meanwhile.
 */
export const useMagicQueueSection = (): MagicQueueSection | null => {
  const picks = saved.useValue();
  const query = useMemo(() => {
    const read = magicQueueRead(picks?.trackIds ?? []);
    return libraryQuery(read.key, read.reads, Effect.flatMap(LibraryStore, read.read));
  }, [picks]);
  const read = useLibraryQuery<readonly PlayableSongRow[] | null>(query, null);
  // New picks keep the songs shown until theirs are read: no placeholder in between.
  const [shown, setShown] = useState(read);
  if (read !== null && read !== shown) setShown(read);
  const songs = read ?? shown;
  const growth = useMemo(() => {
    if (picks === null || picks.trackIds.length >= MAGIC_QUEUE_PICKS) return null;
    const probe = magicQueueGrowthRead(picks.trackIds);
    return libraryQuery(probe.key, probe.reads, Effect.flatMap(LibraryStore, probe.read));
  }, [picks]);
  const grows = useLibraryQuery<boolean>(growth, false);
  const settled = useScreenSettled();
  const busy = useSyncExternalStore(picking.subscribe, picking.get);
  useEffect(() => {
    if (!settled) return;
    // Leaving Home, or a route over it unsettling it, stops the due pick; it starts again once due.
    return () => cancelDue?.();
  }, [settled]);
  useEffect(() => {
    if (
      read !== null &&
      homeMagicQueueDue(
        settled,
        picks,
        read.map((song) => String(song.id)),
        grows,
        Date.now(),
      )
    )
      pick(false);
  }, [picks, read, grows, settled]);
  return useMemo(
    () =>
      songs === null
        ? null
        : {
            songs,
            picking: busy,
            refresh: () => {
              pick(true);
            },
          },
    [songs, busy],
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
