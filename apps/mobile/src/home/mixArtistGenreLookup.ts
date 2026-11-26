import {
  answerBytes,
  catalogSeedKey,
  lookUpDeezerArtistGenre,
  type GenreProfileOf,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { AppState } from "react-native";

import { freeTurnAlone, freeTurnEffect, inSlice } from "@/lib/backgroundWork";
import { namedWork, runSteps } from "@/lib/stepped";
import { online, subscribeConnectivity } from "@/native/waveNative";
import { subscribeYtMusicEnabled, ytMusicEnabled } from "@/settings/ytMusic";

import { genreMixArtistDue, saveGenreMixArtistProfile } from "./artistGenres";

export interface ArtistLookupMeter {
  readonly lookup: () => void;
  readonly received: (bytes: number) => void;
  /** The last lookup this meter queued finished (or was found not due): the build can count them all. */
  readonly settled?: () => void;
}

const JOB = "Genre mix artist lookup";
const pending = new Map<string, { name: string; meter: ArtistLookupMeter }>();
let running = false;
let lastRequestAt = 0;
const allowed = () => ytMusicEnabled() && AppState.currentState === "active" && online();

/** Whether lookups [meter] queued are still waiting or running. */
const mixArtistLookupsPending = (meter: ArtistLookupMeter): boolean => {
  for (const entry of pending.values()) if (entry.meter === meter) return true;
  return false;
};

/** [key]'s lookup is over: its meter hears when it was the last of its own. */
const finish = (key: string, meter: ArtistLookupMeter): void => {
  pending.delete(key);
  if (!mixArtistLookupsPending(meter)) meter.settled?.();
};

const freeTurn = Effect.promise(() => freeTurnAlone(JOB));

/** Deezer's genre profile for [name], its requests spaced and metered, on free turns. */
const lookUp = (name: string, meter: ArtistLookupMeter) =>
  Effect.tryPromise(() => {
    let firstRequest = true;
    return lookUpDeezerArtistGenre(name, async (url) => {
      const wait = lastRequestAt + 400 - Date.now();
      if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
      await freeTurnAlone(JOB);
      if (!allowed()) throw new Error("Genre mix artist lookup paused");
      lastRequestAt = Date.now();
      if (firstRequest) {
        firstRequest = false;
        meter.lookup();
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        const text = await response.text();
        return inSlice(JOB, () => {
          meter.received(answerBytes(response.headers.get("content-length"), text));
          if (!response.ok) throw new Error(`Deezer HTTP ${response.status}`);
          return JSON.parse(text) as unknown;
        });
      } finally {
        clearTimeout(timeout);
      }
    });
  });

/**
 * Works through the queued lookups, one at a time, while YT Music is on, Wave
 * is in front and online; one worker at a time, and three failures in a row
 * leave the rest for the next build or wake.
 */
const drain: Effect.Effect<void> = Effect.suspend(() => {
  if (running || !allowed()) return Effect.void;
  running = true;
  return Effect.gen(function* () {
    let failures = 0;
    for (const [key, { name, meter }] of pending) {
      yield* freeTurn;
      if (!allowed()) return;
      if (!genreMixArtistDue(name)) {
        finish(key, meter);
        continue;
      }
      const found = yield* Effect.result(lookUp(name, meter));
      if (Result.isSuccess(found)) {
        yield* freeTurn;
        inSlice(JOB, () => saveGenreMixArtistProfile(name, found.success));
        failures = 0;
      } else {
        // A failed request isn't a Deezer miss. Let the next build retry it.
        if (!allowed()) return;
        failures++;
      }
      finish(key, meter);
      if (failures >= 3) return;
    }
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        running = false;
      }),
    ),
  );
});

let listening = false;
/** The phone came back in front, online or to YT Music: queued lookups go on. */
const wake = (): void => {
  if (pending.size > 0) Effect.runFork(drain);
};

/**
 * Queues the Deezer lookups of [songs]' artists the Library has no profile of,
 * then works through them in this Effect (the build forks it). Only artist
 * names leave the phone, on a free turn.
 */
export const queueMixArtistGenres = (
  songs: Iterable<{ readonly artists: readonly string[] }>,
  libraryProfileOf: GenreProfileOf,
  meter: ArtistLookupMeter,
) =>
  runSteps(
    (function* () {
      for (const song of songs) {
        for (const name of song.artists) {
          const key = catalogSeedKey(name);
          if (
            key !== null &&
            !pending.has(key) &&
            libraryProfileOf(name) === undefined &&
            genreMixArtistDue(name)
          )
            pending.set(key, { name, meter });
          yield;
        }
      }
    })(),
    freeTurnEffect,
  ).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        if (listening) return;
        listening = true;
        AppState.addEventListener("change", wake);
        subscribeConnectivity(wake);
        subscribeYtMusicEnabled(wake);
      }),
    ),
    Effect.andThen(drain),
    namedWork(JOB),
  );
