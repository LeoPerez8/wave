/** #595: faithful startup replay, selected-worktree source/store/Core, no native throughput claim. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import type { LibraryStore } from "../../src/library/LibraryStore.ts";
import type { FastAgainContext } from "./types.ts";

export const startupReplay = async (context: FastAgainContext, store: LibraryStore["Service"]) => {
  const core = await context.loadModule<typeof import("@wave/core")>("packages/core/src/index.ts");
  const path = "apps/mobile/src/library/startupJobs.ts";
  const jobs = existsSync(resolve(context.root, path))
    ? await context.loadModule<typeof import("../../src/library/startupJobs.ts")>(path)
    : null;
  // Kept link import from an older Wave. Its source rows are not the measured Library size.
  const target = Effect.runSync(store.createPlaylist("Startup resume", []));
  const plan = core.planLinkImport<import("@wave/core").YtAlbumSong, never>(
    {
      service: "spotify",
      playlist: {
        title: "Startup resume",
        artworkUrl: null,
        total: 20,
        truncated: false,
        songs: Array.from({ length: 20 }, (_, i) => ({
          title: `Startup song ${i}`,
          artists: ["Startup artist"],
          album: null,
          durationMs: 180000,
        })),
      },
    },
    [],
  );
  const job = core.startPlaylistImport(plan, { playlistId: target.playlistId, name: target.name });
  const batch = core.queueYtLibraryReads(core.NO_YT_LIBRARY_READS, [
    {
      playlistId: target.playlistId,
      name: target.name,
      source: "PLstartup",
      capped: true,
      favorites: false,
    },
  ]);
  const stepped =
    jobs === null
      ? null
      : await context.loadModule<typeof import("../../src/lib/stepped.ts")>(
          "apps/mobile/src/lib/stepped.ts",
        );
  const awaitCompletion = (done: typeof job, turn: Effect.Effect<void>) =>
    stepped!.runSteps(core.playlistImportCompletionSteps(done, true), turn);
  const roots = Effect.runSync(store.ensureDefaultRoot("/Music")).map((root) => root.path);
  // Match files filed by production (synthetic fixture keys precede credit reconciliation).
  Effect.runSync(store.filesGone([]));
  Effect.runSync(store.markScanned(roots, context.fixture.now));
  return {
    stepped: jobs !== null,
    // Repeatable cold-process inputs. Cleanup is outside all wall/CPU/work measurements.
    reset: () => Effect.runSync(store.replacePlaylistSongs(target.playlistId, [])),
    run: (turn: Effect.Effect<void>) =>
      Effect.gen(function* () {
        // Native default-folder/access queries are omitted; the actual root SQL is measured.
        yield* turn;
        const scanRoots = (yield* store.ensureDefaultRoot("/Music")).map((root) => root.path);
        yield* turn; // Native hasAllFilesAccess resolves after the root-setting SQL.
        const deleted = yield* store.pendingFileDeletions;
        if (deleted.length !== 0) throw new Error("fixture must have no pending file deletions");
        if (jobs !== null) yield* turn;
        const excluded = yield* store.excludedFolders;
        let knownCount = 0,
          indexedCount = 0;
        let firstScan: boolean;
        if (jobs !== null) {
          const index = yield* jobs.readScanIndex(store, scanRoots, turn);
          knownCount = index.known.length;
          indexedCount = index.indexed.size;
          yield* turn;
          firstScan = yield* store.hasUnscannedRoot(scanRoots);
          yield* jobs.scanInputColumns(index.known, turn);
        } else {
          // ti performs these source reads, membership map and three bridge columns in one
          // JS task, with no Promise-wrapper turns inserted between synchronous effects.
          const known = yield* store.knownFiles(scanRoots);
          knownCount = known.length;
          firstScan = yield* store.hasUnscannedRoot(scanRoots);
          indexedCount = new Set(known.map((file) => file.path)).size;
          known.map((file) => file.path);
          known.map((file) => file.sizeBytes);
          known.map((file) => file.modifiedAt);
        }
        yield* turn; // The native unchanged scan completes on a later event-loop task.
        const revision = yield* store.playlistEntriesRevision;
        yield* turn; // Both revisions explicitly wait before the atomic linking effect.
        const linked = yield* store.linkPlaylistEntries; // first launch has linkedAtRevision=null
        if (jobs === null) {
          yield* turn; // ti's one cleanup freeTurnEffect, then markScanned in the same task.
          yield* store.filesGone([]);
        } else {
          yield* jobs.finishScanIndex(store, [], 0, turn);
          yield* turn;
        }
        yield* store.markScanned(scanRoots, context.fixture.now);
        // Link imports resume second, preserving persisted order. Each append is the real store.
        yield* turn;
        if (jobs !== null) {
          const done = yield* jobs.finishLinkImport(store, job, turn);
          if (done !== null) yield* awaitCompletion(done, turn);
        } else {
          const finished = core.finishPlaylistImport(job);
          yield* store.addToPlaylist(target.playlistId, finished.songs);
          core.importLogLine(finished.job, { resumed: true });
          core.updatePlaylistImport([job], finished.job);
        }
        // A kept YT library batch resumes third. Offline pauses before asking the transport;
        // prune and next-read policy use the selected revision, not invented empty work.
        yield* turn;
        const playlists = yield* store.listPlaylists;
        const pruned = core.pruneYtLibraryBatch(
          batch,
          playlists.map((row) => row.id),
        );
        const next = core.nextYtLibraryRead(pruned);
        const paused =
          next === undefined ? null : core.ytLibraryReadFailed(pruned, next, "offline");
        // Scan completion releases a due replacement check. This normal cold launch has no pairs,
        // but reads every eligible MP3/M4A and runs its actual pairing work (size-dependent).
        yield* turn;
        let pairs = 0;
        if (jobs !== null) {
          const checked = yield* jobs.checkDuplicateFiles(store, turn, () =>
            Effect.die("unexpected duplicate fixture"),
          );
          pairs = checked.outcomes.length;
        } else pairs = core.replacementDuplicates(yield* store.duplicateCheckFiles).length;
        core.replacementDuplicateLines("update", []);
        yield* turn;
        const imported = yield* store.getPlaylist(target.playlistId);
        return {
          knownCount,
          indexedCount,
          excluded,
          firstScan,
          revisionRead: revision !== undefined,
          linked,
          imported: imported?.items.map((item) =>
            item.source === "library" ? item.track.id : item.song.title,
          ),
          next: next?.source,
          paused: paused?.pause,
          pairs,
        };
      }),
  };
};
