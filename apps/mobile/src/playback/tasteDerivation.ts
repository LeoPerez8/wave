import {
  magicLibraryMapperSteps,
  tasteProfileSteps,
  sortSteps,
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

// SQLite BINARY uses Unicode code points (not UTF-16 or locale order).
const binary = (a: string, b: string): number => {
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    if (i === a.length) return -1;
    if (j === b.length) return 1;
    const left = a.codePointAt(i)!, right = b.codePointAt(j)!;
    if (left !== right) return left - right;
    i += left > 0xffff ? 2 : 1;
    j += right > 0xffff ? 2 : 1;
  }
  return 0;
};

/** One keyset walk per source; restore ti's title/artist/path order before picking. */
export const readTasteLibrary = (store: LibraryStore["Service"], turn: Effect.Effect<void>) =>
  Effect.gen(function* () {
    const all: SongRow[] = [];
    let after = 0;
    for (;;) {
      yield* turn;
      const page = yield* store.mixSongsPage(after, { genres: false });
      for (const song of page) all.push(song);
      if (page.length === 0) break;
      after = page.at(-1)!.id;
    }
    const songs = yield* runSteps(sortSteps(all, (a, b) =>
      binary(a.titleSort, b.titleSort) || binary(a.artistSort, b.artistSort) ||
      (a.path === null ? b.path === null ? 0 : -1 : b.path === null ? 1 : binary(a.path, b.path))
    ), turn);
    const artists: { id: number; name: string }[] = [];
    after = 0;
    for (;;) {
      yield* turn;
      const page = yield* store.tasteArtistsPage(after);
      for (const artist of page) artists.push(artist);
      if (page.length === 0) break;
      after = page.at(-1)!.id;
    }
    // The mapper indexes unique artist ids; their insertion order is unobservable.
    const convert = yield* runSteps(magicLibraryMapperSteps(artists), turn);
    return yield* runSteps(mapSongs(songs, convert), turn);
  });

export const readTasteHistory = (store: LibraryStore["Service"], turn: Effect.Effect<void>) =>
  Effect.gen(function* () {
    const plays: TasteHistory["plays"][number][] = [];
    let cursor: readonly [number, number] = [-Number.MAX_VALUE, 0];
    for (;;) {
      yield* turn;
      const page = yield* store.tastePlaysPage(cursor);
      for (const play of page.rows) plays.push(play);
      if (page.next === null) break;
      cursor = page.next;
    }
    const favorites: TasteHistory["favorites"][number][] = [];
    let after = 0;
    for (;;) {
      yield* turn;
      const page = yield* store.tasteFavoritesPage(after);
      for (const star of page.rows) favorites.push(star);
      if (page.next === null) break;
      after = page.next;
    }
    const downloads: TasteHistory["downloads"][number][] = [];
    after = 0;
    for (;;) {
      yield* turn;
      const page = yield* store.tasteDownloadsPage(after);
      for (const download of page.rows) downloads.push(download);
      if (page.next === null) break;
      after = page.next;
    }
    return { plays, favorites, downloads };
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
    const history = yield* readTasteHistory(store, turn);
    snapshotTaken(history);
    const input = library ?? (yield* readTasteLibrary(store, turn));
    return yield* runSteps(
      tasteProfileSteps(history, (id) => input.byId.get(id), now),
      turn,
    );
  });
