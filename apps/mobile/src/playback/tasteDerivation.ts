import {
  magicLibraryMapperSteps,
  tasteProfileSteps,
  sortSteps,
  mapSteps,
  type MagicSong,
  type TasteHistory,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { runSteps } from "../lib/stepped.ts";
import { byTitleArtistPath } from "../library/binaryOrder.ts";
import type { LibraryStore, LibraryStoreError, SongRow } from "../library/LibraryStore.ts";

/** One input snapshot shared by the live profile and Home's due pick. Not an Artist graph. */
export interface TasteLibrary {
  readonly revision: string;
  readonly magic: readonly MagicSong[];
  readonly playable: readonly MagicSong[];
  readonly byId: ReadonlyMap<string, MagicSong>;
}

function* mapSongs(
  songs: readonly SongRow[],
  convert: (song: SongRow) => MagicSong,
  revision: string,
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
  return { magic, playable, byId, revision };
}

/** Checked attempts before the last one, which walks its sources in a single task. */
const TASTE_SNAPSHOT_ATTEMPTS = 3;

/** An effect run to its end in the current task: nothing else on this thread runs meanwhile. */
const inOneTask = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  Effect.suspend(() => Effect.runSyncExit(effect));

/**
 * Copies [walk]'s source rows as of one taste revision; the CPU work on the copy comes after,
 * on free turns, and can't mix versions. No transaction is held across turns: a checked
 * attempt walks on free turns and is discarded when a taste write landed meanwhile (the
 * revision counts only what the taste reads, so playback's own saves don't). After
 * TASTE_SNAPSHOT_ATTEMPTS discarded attempts the walk runs once in a single task, where no
 * write on this connection (the app's only one) can land: one long read, as ti's synchronous
 * read always was, instead of restarting for as long as the writes go on.
 */
const tasteSnapshot = <S>(
  store: LibraryStore["Service"],
  turn: Effect.Effect<void>,
  walk: (revision: string, pace: Effect.Effect<void>) => Effect.Effect<S, LibraryStoreError>,
): Effect.Effect<{ readonly revision: string; readonly rows: S }, LibraryStoreError> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < TASTE_SNAPSHOT_ATTEMPTS; attempt++) {
      yield* turn;
      const revision = yield* store.tasteRevision;
      const rows = yield* walk(revision, turn);
      if ((yield* store.tasteRevision) === revision) return { revision, rows };
    }
    yield* turn;
    return yield* inOneTask(
      Effect.gen(function* () {
        const revision = yield* store.tasteRevision;
        return { revision, rows: yield* walk(revision, Effect.void) };
      }),
    );
  });

/** An attempt [stableTasteSnapshot]'s read gave up on, to try again. */
class Discarded extends Error {}
const discard = () => Effect.fail(new Discarded());

/**
 * Retries [read] while a taste write lands during it, for a result that's current when it's
 * published; [read] can ask [unchanged] whether the revision is still the one it read at,
 * and returns `discard()` to try again before spending more on a stale input. The last of
 * TASTE_SNAPSHOT_ATTEMPTS stands as it is: each part [read] reads comes from a snapshot of
 * its own (`tasteSnapshot`), so the last one is stale at worst, never mixed.
 */
export const stableTasteSnapshot = <A, E, R>(
  store: LibraryStore["Service"],
  turn: Effect.Effect<void>,
  read: (
    unchanged: (revision: string) => Effect.Effect<boolean, LibraryStoreError>,
    discard: () => Effect.Effect<never, Discarded>,
  ) => Effect.Effect<A, E | Discarded, R>,
) =>
  Effect.gen(function* () {
    for (let attempt = 1; ; attempt++) {
      const last = attempt === TASTE_SNAPSHOT_ATTEMPTS;
      yield* turn;
      const revision = yield* store.tasteRevision;
      const unchanged = (at: string) =>
        last ? Effect.succeed(true) : Effect.map(store.tasteRevision, (now) => now === at);
      const result = yield* Effect.result(read(unchanged, discard));
      if (Result.isFailure(result)) {
        if (result.failure instanceof Discarded) continue;
        return yield* Effect.fail(result.failure as E);
      }
      if (yield* unchanged(revision)) return result.success;
    }
  });

interface TasteLibraryRows {
  readonly songs: readonly SongRow[];
  readonly artists: readonly { readonly id: number; readonly name: string }[];
}

/** The songs and artists the taste maps, one keyset walk each, copied as they are. */
const tasteLibraryRows = (
  store: LibraryStore["Service"],
  pace: Effect.Effect<void>,
): Effect.Effect<TasteLibraryRows, LibraryStoreError> =>
  Effect.gen(function* () {
    const songs: SongRow[] = [];
    let after = 0;
    for (;;) {
      yield* pace;
      const page = yield* store.mixSongsPage(after, { genres: false });
      yield* runSteps(
        mapSteps(page, (song) => {
          songs.push(song);
        }),
        pace,
      );
      if (page.length === 0) break;
      after = page.at(-1)!.id;
    }
    const artists: { id: number; name: string }[] = [];
    after = 0;
    for (;;) {
      yield* pace;
      const page = yield* store.tasteArtistsPage(after);
      yield* runSteps(
        mapSteps(page, (artist) => {
          artists.push(artist);
        }),
        pace,
      );
      if (page.length === 0) break;
      after = page.at(-1)!.id;
    }
    return { songs, artists };
  });

/** ti's title/artist/path order restored, then mapped for picking. */
const tasteLibraryOf = (
  { songs, artists }: TasteLibraryRows,
  revision: string,
  turn: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const sorted = yield* runSteps(sortSteps(songs, byTitleArtistPath), turn);
    // The mapper indexes unique artist ids; their insertion order is unobservable.
    const convert = yield* runSteps(magicLibraryMapperSteps(artists), turn);
    return yield* runSteps(mapSongs(sorted, convert, revision), turn);
  });

export const readTasteLibrary = (store: LibraryStore["Service"], turn: Effect.Effect<void>) =>
  Effect.gen(function* () {
    const { revision, rows } = yield* tasteSnapshot(store, turn, (_, pace) =>
      tasteLibraryRows(store, pace),
    );
    return yield* tasteLibraryOf(rows, revision, turn);
  });

export const readTasteHistory = (store: LibraryStore["Service"], turn: Effect.Effect<void>) =>
  Effect.gen(function* () {
    const plays: TasteHistory["plays"][number][] = [];
    let cursor: readonly [number, number] = [-Number.MAX_VALUE, 0];
    for (;;) {
      yield* turn;
      const page = yield* store.tastePlaysPage(cursor);
      yield* runSteps(
        mapSteps(page.rows, (play) => {
          plays.push(play);
        }),
        turn,
      );
      if (page.next === null) break;
      cursor = page.next;
    }
    const favorites: TasteHistory["favorites"][number][] = [];
    let after = 0;
    for (;;) {
      yield* turn;
      const page = yield* store.tasteFavoritesPage(after);
      yield* runSteps(
        mapSteps(page.rows, (star) => {
          favorites.push(star);
        }),
        turn,
      );
      if (page.next === null) break;
      after = page.next;
    }
    const downloads: TasteHistory["downloads"][number][] = [];
    after = 0;
    for (;;) {
      yield* turn;
      const page = yield* store.tasteDownloadsPage(after);
      yield* runSteps(
        mapSteps(page.rows, (download) => {
          downloads.push(download);
        }),
        turn,
      );
      if (page.next === null) break;
      after = page.next;
    }
    return { plays, favorites, downloads };
  });

/**
 * The same scores as ti, using an optional already-read Library snapshot when it's still
 * current; one read at another revision would mix versions, so the Library is read again
 * with the history instead.
 */
export const deriveTaste = (
  store: LibraryStore["Service"],
  turn: Effect.Effect<void>,
  now: number,
  library?: TasteLibrary,
  snapshotTaken: (history: TasteHistory) => void = () => {},
) =>
  Effect.gen(function* () {
    const { revision, rows } = yield* tasteSnapshot(store, turn, (at, pace) =>
      Effect.gen(function* () {
        const history = yield* readTasteHistory(store, pace);
        const own = library?.revision === at ? null : yield* tasteLibraryRows(store, pace);
        return { history, own };
      }),
    );
    snapshotTaken(rows.history);
    const input = rows.own === null ? library! : yield* tasteLibraryOf(rows.own, revision, turn);
    return yield* runSteps(
      tasteProfileSteps(rows.history, (id) => input.byId.get(id), now),
      turn,
    );
  });
