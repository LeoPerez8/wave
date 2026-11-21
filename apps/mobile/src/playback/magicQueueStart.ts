import { currentLocalisation } from "@/localisation/localisation";
/**
 * Starting a Magic Queue from a tap or a menu: the start runs on the app's
 * runtime, and a failure says "Couldn't start the Magic Queue" ("Couldn't
 * play the song" for a song tapped in Search, `runSongPlay`). Its own
 * module because the runtime builds `MagicQueue.ts`'s layer.
 */
import { streamedSongMagicStart, type YtSong } from "@wave/core";
import type * as Effect from "effect/Effect";
import type * as ManagedRuntime from "effect/ManagedRuntime";

import type { SongRow } from "@wave/client";
import { appRuntime } from "@/library/runtime";
import { showError } from "@/overlay/alert";

import { startStreamedMagicQueue } from "./MagicQueue";

type AppServices = ManagedRuntime.ManagedRuntime.Services<typeof appRuntime>;

const run = <A, E>(
  start: Effect.Effect<A, E, AppServices>,
  failure: "couldntStartTheMagicQueue" | "couldntPlayTheSong",
): void => {
  appRuntime
    .runPromise(start)
    .catch((error: unknown) =>
      showError(currentLocalisation().strings.playbackText[failure], error),
    );
};

/** Runs [start] (a Magic Queue starting), saying so when it fails. */
export const runMagicQueueStart = <A, E>(start: Effect.Effect<A, E, AppServices>): void =>
  run(start, "couldntStartTheMagicQueue");

/** Runs [start] (a song played from Search, with its related songs), saying so when it fails. */
export const runSongPlay = <A, E>(start: Effect.Effect<A, E, AppServices>): void =>
  run(start, "couldntPlayTheSong");

/**
 * Starts a Magic Queue from streamed [song]: when [found] (the Library's
 * matching song) has a file it supplies playback, while the session stays
 * seeded by [song]; otherwise the stream supplies playback too.
 */
export const startMagicQueueFromStream = (song: YtSong, found: SongRow | null): void => {
  const start = streamedSongMagicStart(found);
  runMagicQueueStart(
    start.from === "library"
      ? startStreamedMagicQueue(song, {}, start.track)
      : startStreamedMagicQueue(song),
  );
};
