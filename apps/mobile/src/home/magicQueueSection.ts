/**
 * Home's Magic Queue section (docs/spec.md, Magic Queue): nine of the
 * Library's songs to start a Magic Queue from with one tap. Which songs,
 * when they change and what a pull brings are Core's (`magicQueuePicks`,
 * `refreshedMagicQueuePicks`, `undoneMagicQueueRefresh`), weighed by the
 * taste profile (`tasteProfileNow`); this keeps what the section shows on
 * the phone and picks again when it's due (a new day, a song gone).
 */
import {
  MAGIC_QUEUE_PICKS,
  parseMagicQueuePicks,
  storedMagicQueuePicks,
  undoneMagicQueueRefresh,
  type MagicQueuePicks,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useSyncExternalStore } from "react";

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

/** A pick under way is shared across consumers; the existing scheduler owns its turns. */
const picking = makeExternalStore(false);
let active: AbortController | null = null;
let cancelActive: (() => void) | undefined;

const pick = (refresh: boolean): (() => void) | undefined => {
  if (active !== null) return;
  const previous = saved.get();
  const controller = new AbortController();
  active = controller;
  picking.set(true);
  const finish = () => {
    if (active !== controller) return;
    active = null;
    cancelActive = undefined;
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
      // Best effort: previous choices remain until a later successful build.
    })
    .finally(finish);
  const cancel = () => {
    finish();
    controller.abort();
  };
  cancelActive = cancel;
  return cancel;
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
  const picks = saved.useValue();
  const query = useMemo(() => {
    const read = magicQueueRead(picks?.trackIds ?? []);
    return libraryQuery(read.key, read.reads, Effect.flatMap(LibraryStore, read.read));
  }, [picks]);
  const songs = useLibraryQuery<readonly PlayableSongRow[] | null>(query, null);
  const growth = useMemo(() => {
    if (picks === null || picks.trackIds.length >= MAGIC_QUEUE_PICKS) return null;
    const read = magicQueueGrowthRead(picks.trackIds);
    return libraryQuery(read.key, read.reads, Effect.flatMap(LibraryStore, read.read));
  }, [picks]);
  const grows = useLibraryQuery<boolean>(growth, false);
  const settled = useScreenSettled();
  const busy = useSyncExternalStore(picking.subscribe, picking.get);
  useEffect(() => {
    if (!settled) cancelActive?.();
    return () => cancelActive?.();
  }, [settled]);
  useEffect(() => {
    if (
      songs === null ||
      !homeMagicQueueDue(
        settled,
        picks,
        songs.map((song) => String(song.id)),
        grows,
        Date.now(),
      )
    )
      return;
    return pick(false);
  }, [picks, songs, grows, settled]);
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
