import {
  answerBytes,
  catalogSeedKey,
  lookUpDeezerArtistGenre,
  type GenreProfileOf,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { AppState } from "react-native";

import { freeTurnAlone, freeTurnEffect, inSlice } from "@/lib/backgroundWork";
import { namedWork, runSteps } from "@/lib/stepped";
import { online, subscribeConnectivity } from "@/native/waveNative";
import { subscribeYtMusicEnabled, ytMusicEnabled } from "@/settings/ytMusic";

import { genreMixArtistDue, saveGenreMixArtistProfile } from "./artistGenres";

export interface ArtistLookupMeter {
  readonly lookup: () => void;
  readonly received: (bytes: number) => void;
}

const JOB = "Genre mix artist lookup";
const pending = new Map<string, { name: string; meter: ArtistLookupMeter }>();
let running = false;
let lastRequestAt = 0;
const allowed = () => ytMusicEnabled() && AppState.currentState === "active" && online();

const drain = async (): Promise<void> => {
  if (running || !allowed()) return;
  running = true;
  let failures = 0;
  try {
    for (const [key, { name, meter }] of pending) {
      await freeTurnAlone(JOB);
      if (!allowed()) return;
      if (!genreMixArtistDue(name)) {
        pending.delete(key);
        continue;
      }
      try {
        let firstRequest = true;
        const profile = await lookUpDeezerArtistGenre(name, async (url) => {
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
        await freeTurnAlone(JOB);
        inSlice(JOB, () => saveGenreMixArtistProfile(name, profile));
        failures = 0;
      } catch {
        // A failed request isn't a Deezer miss. Let the next build retry it.
        if (!allowed()) return;
        failures++;
      }
      pending.delete(key);
      if (failures >= 3) return;
    }
  } finally {
    running = false;
  }
};

let listening = false;
const wake = (): void => {
  if (pending.size > 0) void drain();
};

/** Detached from the build. Only artist names leave the phone, on a free turn. */
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
        if (!listening) {
          listening = true;
          AppState.addEventListener("change", wake);
          subscribeConnectivity(wake);
          subscribeYtMusicEnabled(wake);
        }
        wake();
      }),
    ),
    namedWork(JOB),
  );
