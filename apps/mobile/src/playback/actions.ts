import * as Effect from "effect/Effect";

import type { SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import type { PlayerItem } from "@/native/wavePlayer";

import { Player, playbackState } from "./Player";

const toItem = (song: SongRow): PlayerItem => ({
  id: String(song.id),
  path: song.path,
  title: song.title,
  artist: song.artist,
  album: song.album,
  artworkPath: song.artworkPath,
});

const run = (effect: Effect.Effect<void, unknown, Player>): void => {
  void appRuntime.runPromise(effect).catch((error: unknown) =>
    playbackState.update((state) => ({
      ...state,
      error: error instanceof Error ? error.message : String(error),
    })),
  );
};

/** Starts the player's event sync, so a session that is already playing shows up. */
export const connectPlayer = (): void => run(Effect.asVoid(Player));

/** Plays one song from the start. Queueing the rest of its context comes with the queue engine (#7). */
export const playSong = (song: SongRow): void =>
  run(
    Effect.gen(function* () {
      const player = yield* Player;
      yield* player.setItems([toItem(song)], 0);
    }),
  );

export const togglePlayPause = (): void =>
  run(
    Effect.gen(function* () {
      const player = yield* Player;
      yield* playbackState.get().playWhenReady ? player.pause : player.play;
    }),
  );
