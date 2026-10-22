/** Desktop replay of PlaylistRecommendations' public session/change-bus wiring.
 * No React mounting or rendering is simulated. Visibility is absent from the
 * production subscription: a retained screen keeps exactly this wiring.
 */
import * as Effect from "effect/Effect";
import { traceQueries } from "../../src/library/db/testDatabase.ts";
import type { FastAgainFixture } from "../../src/library/db/fastAgainFixture.ts";
import { loadLibraryStore, loadWorktreeModule } from "./store.ts";

export const createPlaylistReplay = async (root: string, fixture: FastAgainFixture) => {
  const store = await loadLibraryStore(root, fixture.db);
  if (store.playlistRecommendationInput === undefined) return null;
  const core = await loadWorktreeModule<typeof import("@wave/core")>(
    root,
    "packages/core/src/index.ts",
  );
  const bus = await loadWorktreeModule<typeof import("../../src/library/libraryChanges.ts")>(
    root,
    "apps/mobile/src/library/libraryChanges.ts",
  );
  const work = { reads: 0, rowsRead: 0, statements: 0, notifications: 0 };
  let tracing = false;
  let pending: Promise<void>[] = [];
  const sessions: ReturnType<typeof core.playlistRecommendationSession>[] = [];
  const stops: (() => void)[] = [];
  let nextId = 0;
  return {
    work,
    mount: async () => {
      const session = core.playlistRecommendationSession({
        newId: () => String(++nextId),
        read: async () => {
          work.reads++;
          const run = () => Effect.runSync(store.playlistRecommendationInput(fixture.playlistId));
          const traced = tracing ? traceQueries(fixture.db, run) : null;
          const input = traced === null ? run() : traced.result;
          if (traced !== null) {
            work.rowsRead += traced.queries.reduce((sum, query) => sum + query.rows, 0);
            work.statements += traced.queries.length;
          }
          return {
            playlist: input.playlist,
            sources: {
              ...input,
              graph: null,
              now: fixture.now,
              online: false,
              ytMusicEnabled: false,
            },
          };
        },
        dismiss: async () => {
          throw new Error("read-only replay");
        },
      });
      sessions.push(session);
      stops.push(
        session.subscribe(() => {
          work.notifications++;
        }),
      );
      stops.push(
        bus.onLibraryChange((change) => {
          if (
            core.libraryChangeAffects(
              { tracks: true, favorites: true, playlists: [fixture.playlistId] },
              change,
            )
          )
            pending.push(session.renew());
        }),
      );
      await session.renew();
    },
    change: async (trace: boolean) => {
      work.reads = work.rowsRead = work.statements = work.notifications = 0;
      pending = [];
      tracing = trace;
      try {
        bus.publishLibraryChange({ kind: "tracks", ids: [fixture.songIds.at(-1)!], burst: true });
        await Promise.all(pending);
        if (sessions.some((session) => session.get().error !== null))
          throw new Error("renewal failed");
        return sessions.map((session) =>
          session.get().slots.map((offer) => offer?.track.id ?? null),
        );
      } finally {
        tracing = false;
      }
    },
    close: () => {
      for (const stop of stops) stop();
    },
  };
};
