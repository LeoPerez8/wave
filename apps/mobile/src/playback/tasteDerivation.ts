import {
  magicLibraryMapperSteps,
  tasteProfileSteps,
  type MagicSong,
  type TasteHistory,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { runSteps } from "../lib/stepped.ts";
import type { LibraryStore, SongRow } from "../library/LibraryStore.ts";

/** One input snapshot shared by the live profile and Home's due pick. Not an Artist graph. */
export interface TasteLibrary {
  readonly magic: readonly MagicSong[];
  readonly playable: readonly MagicSong[];
  readonly byId: ReadonlyMap<string, MagicSong>;
}

function* mapSongs(
  songs: readonly SongRow[],
  convert: (song: SongRow) => MagicSong,
): Generator<void, TasteLibrary> {
  const magic: MagicSong[] = [];
  const playable: MagicSong[] = [];
  const byId = new Map<string, MagicSong>();
  for (const song of songs) {
    const mapped = convert(song);
    magic.push(mapped);
    byId.set(mapped.trackId, mapped);
    if (song.path !== null) playable.push(mapped);
    yield;
  }
  return { magic, playable, byId };
}

/** Whole-Library reads belong only to a due background job, once per input snapshot. */
export const readTasteLibrary = (store: LibraryStore["Service"], turn: Effect.Effect<void>) =>
  Effect.gen(function* () {
    yield* turn;
    const songs = yield* store.listSongs;
    yield* turn;
    const artists = yield* store.listArtists;
    const convert = yield* runSteps(magicLibraryMapperSteps(artists), turn);
    return yield* runSteps(mapSongs(songs, convert), turn);
  });

/** The same scores as ti, using an optional already-read Library snapshot. */
export const deriveTaste = (
  store: LibraryStore["Service"],
  turn: Effect.Effect<void>,
  now: number,
  library?: TasteLibrary,
  snapshotTaken: (history: TasteHistory) => void = () => {},
) =>
  Effect.gen(function* () {
    yield* turn;
    const history = yield* store.tasteHistory;
    snapshotTaken(history);
    const input = library ?? (yield* readTasteLibrary(store, turn));
    return yield* runSteps(
      tasteProfileSteps(history, (id) => input.byId.get(id), now),
      turn,
    );
  });
