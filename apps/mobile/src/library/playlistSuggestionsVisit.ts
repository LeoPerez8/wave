/**
 * The phone's playlist suggestions visit: the shared visit (`@wave/client/playlistSuggestionsVisit`)
 * over the phone's recommendation snapshot, song radios, Library store and key-value store.
 */
import {
  createPlaylistSuggestionsVisit as createSharedVisit,
  type PlaylistSuggestionsHost,
  type PlaylistSuggestionsRead,
} from "@wave/client/playlistSuggestionsVisit";
import * as Effect from "effect/Effect";

import { lookedUpProfileOf } from "@/home/artistGenres";
import { afterPaint } from "@/lib/afterPaint";
import { settledTurnEffect } from "@/lib/backgroundWork";
import { recommendationSteps, recommendationTurn } from "@/lib/recommendationWork";
import { appLog } from "@/log/appLog";
import { online as phoneOnline } from "@/native/waveNative";

import { LibraryStore } from "./LibraryStore";
import { onLibraryChange } from "./libraryChanges";
import {
  playlistRecommendationGraph,
  playlistRecommendationInput,
} from "./playlistRecommendationSource";
import { playlistSuggestionRadios, playlistSuggestionSeeds } from "./playlistSuggestionRadios";
import { phoneSuggestionStorage } from "./playlistSuggestionStorage";
import { playlistsChanged } from "./playlists";
import { appRuntime } from "./runtime";

/** How long loading waits for the screen to settle and a free turn, against the 3 s other work allows. */
const SETTLE_WAIT_MS = 600;

const phoneHost: PlaylistSuggestionsHost = {
  storage: phoneSuggestionStorage,
  online: phoneOnline,
  now: () => performance.now(),
  read: (playlistId, signal) =>
    appRuntime.runPromise(playlistRecommendationInput(playlistId), {
      signal,
    }) as Promise<PlaylistSuggestionsRead>,
  graph: (signal) => appRuntime.runPromise(playlistRecommendationGraph, { signal }),
  profileOf: lookedUpProfileOf,
  seeds: playlistSuggestionSeeds,
  radios: (visitId, seeds, when, signal) =>
    appRuntime.runPromise(playlistSuggestionRadios(visitId, seeds, when), { signal }),
  steps: (steps, awaited, signal) =>
    appRuntime.runPromise(recommendationSteps(steps, awaited), signal ? { signal } : undefined),
  dismiss: (playlistId, offer) =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        return yield* store.dismissPlaylistRecommendation(playlistId, offer);
      }),
    ),
  accept: (playlistId, offer) =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        return yield* store.acceptPlaylistRecommendation(playlistId, offer);
      }),
    ),
  accepted: (playlistId) => playlistsChanged([playlistId]),
  log: (line) => appLog("info", "WaveTiming", line),
  afterPaint,
  freeTurn: recommendationTurn,
  settle: (signal) =>
    appRuntime.runPromise(Effect.raceFirst(settledTurnEffect, Effect.sleep(SETTLE_WAIT_MS)), {
      signal,
    }),
  changes: onLibraryChange,
};

/** A playlist visit's suggestions on the phone; see the shared `createPlaylistSuggestionsVisit`. */
export const createPlaylistSuggestionsVisit = (playlistId: number) =>
  createSharedVisit(playlistId, phoneHost);

export type PlaylistSuggestionsVisit = ReturnType<typeof createPlaylistSuggestionsVisit>;
