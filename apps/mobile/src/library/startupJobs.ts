/** Production startup work, with injectable free turns for desktop work-count/clock tests. */
import {
  finishPlaylistImportSteps,
  libraryImportFinderSteps,
  unsearchedSongJob,
  reconcileScanSteps,
  replacementDuplicatesSteps,
  replacementDuplicateFixSteps,
  type ScanReconcileInput,
  type DuplicateOutcome,
  type ReplacementDuplicate,
  type PlaylistImport,
  type YtAlbumSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { runSteps } from "../lib/stepped.ts";
import type { IndexedArtwork, IndexedTrack, LibraryStore } from "./LibraryStore.ts";

/** One append transaction is indivisible; every song has its own cancellable turn. */
export const finishLinkImport = (
  store: LibraryStore["Service"],
  job: PlaylistImport<YtAlbumSong>,
  turn: Effect.Effect<void>,
  current: () => boolean = () => true,
  saved: () => void = () => {},
) =>
  Effect.gen(function* () {
    const finished = yield* runSteps(finishPlaylistImportSteps(job), turn);
    for (const song of finished.songs) {
      yield* turn;
      if (!current()) return null;
      yield* store.addToPlaylist(job.playlistId, [song]);
      saved();
    }
    return current() ? finished.job : null;
  });

/** Source SQLite read is indivisible; building the membership index yields per file. */
export const readScanIndex = (
  store: LibraryStore["Service"],
  roots: readonly string[],
  turn: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    yield* turn;
    const known = yield* store.knownFiles(roots);
    const indexed = yield* runSteps(
      (function* () {
        const paths = new Set<string>();
        for (const file of known) {
          paths.add(file.path);
          yield;
        }
        return paths;
      })(),
      turn,
    );
    return { known, indexed };
  });

/** Reconciliation and one-track save transactions keep cancellation/restart semantics. */
export const saveScanBatch = (
  store: LibraryStore["Service"],
  input: ScanReconcileInput<IndexedTrack>,
  artwork: readonly IndexedArtwork[],
  turn: Effect.Effect<void>,
  saved: (batch: {
    readonly starred: readonly number[];
    readonly trackIds: readonly number[];
  }) => void = () => {},
) =>
  Effect.gen(function* () {
    const changes = yield* runSteps(reconcileScanSteps(input), turn);
    // Artwork may be larger than the tracks saved. Each artwork transaction gets its own turn.
    for (const row of artwork) {
      yield* turn;
      yield* store.saveBatch([], [row], [], { linkEntries: false });
    }
    let count = 0;
    const ids: number[] = [];
    function* writes() {
      for (const track of changes.added) yield { track, moves: [] };
      for (const track of changes.updated) yield { track, moves: [] };
      for (const move of changes.moved)
        yield { track: move.to, moves: [{ from: move.from, to: move.to.path }] };
    }
    for (const { track, moves } of writes()) {
      yield* turn;
      const result = yield* store.saveBatch([track], [], moves, { linkEntries: false });
      saved(result);
      ids.push(...result.trackIds);
      count++;
    }
    return { changes, count, ids };
  });

/** Pair source SQL and one pair's native audio read/atomic history merge are indivisible. */
export const checkDuplicateFiles = (
  store: LibraryStore["Service"],
  turn: Effect.Effect<void>,
  lengths: (paths: readonly string[]) => Effect.Effect<readonly (number | null)[], unknown>,
) =>
  Effect.gen(function* () {
    yield* turn;
    const files = yield* store.duplicateCheckFiles;
    const pairs = yield* runSteps(replacementDuplicatesSteps(files), turn);
    const outcomes: { pair: ReplacementDuplicate; outcome: DuplicateOutcome }[] = [];
    const changed: number[] = [];
    for (const pair of pairs) {
      yield* turn;
      const read = yield* lengths([pair.old.path, pair.new.path]);
      yield* turn;
      const fix = yield* runSteps(
        replacementDuplicateFixSteps(pair, { old: read[0] ?? null, new: read[1] ?? null }),
        turn,
      );
      yield* turn;
      if (fix.kind === "leave") {
        outcomes.push({ pair, outcome: fix });
        continue;
      }
      const fixed = yield* store.fixReplacementDuplicate(fix);
      outcomes.push({ pair, outcome: fixed ? fix : { kind: "leave", reason: "changed" } });
      if (fixed) changed.push(fix.keep.id, fix.drop.id);
    }
    return { outcomes, changed };
  });

/** Build the three native scanner columns in budgeted CPU steps, before its indivisible bridge call. */
export const scanInputColumns = (
  known: readonly { path: string; sizeBytes: number; modifiedAt: number }[],
  turn: Effect.Effect<void>,
) =>
  runSteps(
    (function* () {
      const paths: string[] = [],
        sizes: number[] = [],
        modified: number[] = [];
      for (const file of known) {
        paths.push(file.path);
        sizes.push(file.sizeBytes);
        modified.push(file.modifiedAt);
        yield;
      }
      return { paths, sizes, modified };
    })(),
    turn,
  );

/** An unchanged incremental scan has nothing to prune. Changed scans retain atomic cleanup. */
export const finishScanIndex = (
  store: LibraryStore["Service"],
  missing: readonly string[],
  saved: number,
  turn: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    if (missing.length === 0 && saved === 0) return;
    yield* turn;
    yield* store.filesGone(missing);
  });

/** A filled import prepares Library membership before handing entries to the download service. */
export const readImportDownloadInput = (
  store: LibraryStore["Service"],
  playlistId: number,
  turn: Effect.Effect<void>,
  current: () => boolean = () => true,
) =>
  Effect.gen(function* () {
    yield* turn;
    if (!current()) return null;
    const detail = yield* store.getPlaylist(playlistId);
    if (detail === null || detail.items.length === 0) return null;
    yield* turn;
    if (!current()) return null;
    const library = yield* store.listSongs;
    const find = yield* runSteps(libraryImportFinderSteps(library), turn);
    const matched = yield* runSteps(
      (function* () {
        const ids = new Set<string>();
        for (const entry of detail.items) {
          if (entry.source !== "library") {
            const song = entry.source === "stream" ? entry.song : unsearchedSongJob(entry.song);
            if ((yield* find(song)) !== null) ids.add(song.videoId);
          }
          yield;
        }
        return ids;
      })(),
      turn,
    );
    yield* turn;
    return current()
      ? { detail, inLibrary: (song: { readonly videoId: string }) => matched.has(song.videoId) }
      : null;
  });
