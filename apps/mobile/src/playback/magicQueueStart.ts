import { currentLocalisation } from "@/localisation/localisation";
/**
 * Starting a Magic Queue from a tap or a menu: the start runs on the app's
 * runtime, and a failure says "Couldn't start the Magic Queue". Its own
 * module because the runtime builds `MagicQueue.ts`'s layer.
 */
import { streamedSongMagicStart, type YtSong } from "@wave/core";
import type * as Effect from "effect/Effect";
import type * as ManagedRuntime from "effect/ManagedRuntime";

import type { SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { showError } from "@/overlay/alert";

import { startMagicQueue, startStreamedMagicQueue } from "./MagicQueue";

type AppServices = ManagedRuntime.ManagedRuntime.Services<typeof appRuntime>;

/** Runs [start] (a Magic Queue starting), saying so when it fails. */
export const runMagicQueueStart = <A, E>(start: Effect.Effect<A, E, AppServices>): void => {
  appRuntime
    .runPromise(start)
    .catch((error: unknown) => showError(currentLocalisation().strings.playbackText.couldntStartTheMagicQueue, error));
};

/**
 * Starts a Magic Queue from streamed [song]: from the Library's file when
 * [found] (the Library's song it is) has one, as that song's own menu would,
 * else from the stream's radio (Core's `streamedSongMagicStart`).
 */
export const startMagicQueueFromStream = (song: YtSong, found: SongRow | null): void => {
  const start = streamedSongMagicStart(found);
  runMagicQueueStart(
    start.from === "library"
      ? startMagicQueue(start.seed, [start.track])
      : startStreamedMagicQueue(song),
  );
};
