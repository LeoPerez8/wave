/** Desktop replay of actual store/Core and the production visit/source lifetime seams. */
import * as Effect from "effect/Effect";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setImmediate } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { traceQueries } from "../../src/library/db/testDatabase.ts";
import type { FastAgainFixture } from "../../src/library/db/fastAgainFixture.ts";
import { loadLibraryStore, loadWorktreeModule } from "./store.ts";

export const createPlaylistReplay = async (
  root: string,
  fixture: FastAgainFixture,
  graphMode: "null" | "warm" | "cold" = "null",
) => {
  const rawStore = await loadLibraryStore(root, fixture.db);
  if (rawStore.playlistRecommendationInput === undefined) return null;
  const core = await loadWorktreeModule<typeof import("@wave/core")>(
    root,
    "packages/core/src/index.ts",
  );
  const bus = await loadWorktreeModule<typeof import("../../src/library/libraryChanges.ts")>(
    root,
    "apps/mobile/src/library/libraryChanges.ts",
  );
  const modern = existsSync(
    resolve(root, "apps/mobile/src/library/playlistRecommendationVisit.ts"),
  );
  const work = { reads: 0, ranks: 0, rowsRead: 0, statements: 0, notifications: 0 };
  let measuring = false,
    tracing = false;
  let started: number | undefined;
  const tasks: number[] = [],
    taskRows: number[] = [],
    taskStatements: number[] = [];
  let rowsInTask = 0,
    statementsInTask = 0;
  const endTask = () => {
    if (measuring && started !== undefined) {
      tasks.push(performance.now() - started);
      taskRows.push(rowsInTask);
      taskStatements.push(statementsInTask);
      rowsInTask = statementsInTask = 0;
      started = undefined;
    }
  };
  const turn = Effect.gen(function* () {
    endTask();
    yield* Effect.promise(() => setImmediate());
    if (measuring) started = performance.now();
  });
  const store = { ...rawStore };
  const note = <A>(read: Effect.Effect<A, unknown>) =>
    Effect.sync(() => {
      if (!measuring || !tracing) return Effect.runSync(read);
      const traced = traceQueries(fixture.db, () => Effect.runSync(read));
      const rows = traced.queries.reduce((sum, q) => sum + q.rows, 0);
      work.rowsRead += rows;
      work.statements += traced.queries.length;
      rowsInTask += rows;
      statementsInTask += traced.queries.length;
      return traced.result;
    });
  for (const [key, value] of Object.entries(rawStore)) {
    if (typeof value === "function")
      (store as Record<string, unknown>)[key] = (...args: unknown[]) =>
        note((value as (...args: unknown[]) => Effect.Effect<unknown, unknown>)(...args));
    else if (Effect.isEffect(value))
      (store as Record<string, unknown>)[key] = note(value as Effect.Effect<unknown, unknown>);
  }
  const sourceModule = modern
    ? await loadWorktreeModule<typeof import("../../src/library/playlistRecommendationInputs.ts")>(
        root,
        "apps/mobile/src/library/playlistRecommendationInputs.ts",
      )
    : null;
  const catalogWrites = new Set<() => void>();
  const source = sourceModule?.observePlaylistRecommendationInputs(
    store,
    turn,
    bus.onLibraryChange,
    (listener) => {
      catalogWrites.add(listener);
      return () => catalogWrites.delete(listener);
    },
  );
  const visitModule = modern
    ? await loadWorktreeModule<typeof import("../../src/library/playlistRecommendationVisit.ts")>(
        root,
        "apps/mobile/src/library/playlistRecommendationVisit.ts",
      )
    : null;
  const steps = modern
    ? await loadWorktreeModule<typeof import("../../src/lib/stepped.ts")>(
        root,
        "apps/mobile/src/lib/stepped.ts",
      )
    : null;
  const graphModule =
    graphMode === "null"
      ? null
      : await loadWorktreeModule<typeof import("../../src/home/artistGraph.ts")>(
          root,
          "apps/mobile/src/home/artistGraph.ts",
        );
  let graph: import("@wave/core").ArtistGraph | null = null;
  if (graphMode === "warm")
    graph = await Effect.runPromise(graphModule!.readArtistGraph(store, turn));
  const graphRead = async (signal?: AbortSignal) => {
    if (graphMode === "null" || graph !== null) return graph;
    // Same shared graph input/build as the selected revision; one build per replay.
    const next = await Effect.runPromise(graphModule!.readArtistGraph(store, turn), { signal });
    if (!signal?.aborted) graph = next;
    return next;
  };
  const pending = new Set<Promise<void>>();
  const sessions: ReturnType<typeof core.playlistRecommendationSession>[] = [];
  const controls: { show: (visible: boolean) => void; settle: () => void }[] = [];
  const stops: (() => void)[] = [];
  let nextId = 0;
  const drain = async () => {
    for (let i = 0; i < 3; i++) {
      await Promise.all(pending);
      endTask();
      await setImmediate();
      if (measuring) started = performance.now();
    }
  };
  const identities = () =>
    sessions.map((session) =>
      session
        .get()
        .slots.map((offer) =>
          offer === null ? null : { id: offer.track.id, scorelessTrack: offer.track },
        ),
    );
  return {
    work,
    modern,
    tasks,
    taskRows,
    taskStatements,
    store,
    sessions,
    input: (signal?: AbortSignal) => {
      if (measuring) work.reads++;
      return source === undefined
        ? Effect.runPromise(store.playlistRecommendationInput(fixture.playlistId))
        : Effect.runPromise(source.get(fixture.playlistId), { signal });
    },
    /** The next input reads everything again: a forget before the snapshot, writes since. */
    forget: () => {
      const older = source as { forget?: () => void } | undefined;
      if (older?.forget !== undefined) return older.forget();
      bus.publishLibraryChange({ kind: "tracks" });
      for (const written of catalogWrites) written();
    },
    rank: async (
      input: Pick<
        import("@wave/core").PlaylistRecommendationSources,
        "library" | "catalog" | "favoriteVideos" | "feedback"
      > & { readonly playlist: readonly import("@wave/core").PlaylistRecommendationTrack[] },
    ) => {
      work.ranks++;
      const sources = {
        ...input,
        graph: await graphRead(),
        now: fixture.now,
        online: false,
        ytMusicEnabled: false,
      };
      return modern
        ? Effect.runPromise(
            steps!.runSteps(core.playlistRecommendationsSteps(input.playlist, sources), turn),
          )
        : core.playlistRecommendations(input.playlist, sources);
    },
    begin: (trace = true) => {
      for (const key of Object.keys(work) as (keyof typeof work)[]) work[key] = 0;
      tasks.length = taskRows.length = taskStatements.length = 0;
      rowsInTask = statementsInTask = 0;
      measuring = true;
      tracing = trace;
      started = performance.now();
    },
    end: async () => {
      await drain();
      endTask();
      measuring = false;
      return identities();
    },
    drain,
    mount: async ({
      visible = true,
      settled = true,
      playlistId = fixture.playlistId,
    }: { visible?: boolean; settled?: boolean; playlistId?: number } = {}) => {
      const session = core.playlistRecommendationSession({
        newId: () => String(++nextId),
        read: async (signal) => {
          if (measuring) work.reads++;
          const input =
            source === undefined
              ? await Effect.runPromise(store.playlistRecommendationInput(playlistId))
              : await Effect.runPromise(source.get(playlistId), { signal });
          const inputGraph = await graphRead(signal);
          // Ti ranks once after each successful read, not once per renewal request.
          if (!modern && measuring) work.ranks++;
          return {
            playlist: input.playlist,
            sources: {
              ...input,
              graph: inputGraph,
              now: fixture.now,
              online: false,
              ytMusicEnabled: false,
            },
          };
        },
        rank: modern
          ? async (input, signal) => {
              if (measuring) work.ranks++;
              return Effect.runPromise(
                steps!.runSteps(
                  core.playlistRecommendationsSteps(input.playlist, input.sources),
                  turn,
                ),
                { signal },
              );
            }
          : undefined,
        dismiss: async (offer) => {
          await Effect.runPromise(store.dismissPlaylistRecommendation(playlistId, offer));
        },
        accept: async (offer) => {
          await Effect.runPromise(store.acceptPlaylistRecommendation(playlistId, offer));
        },
      });
      const renew = session.renew;
      session.renew = (request) => {
        const promise = renew(request);
        pending.add(promise);
        void promise.finally(() => pending.delete(promise));
        return promise;
      };
      sessions.push(session);
      stops.push(
        session.subscribe(() => {
          if (measuring) work.notifications++;
        }),
      );
      if (visitModule !== null) {
        const listeners = new Set<() => void>();
        let inSight = visible,
          isSettled = settled;
        const sight = {
          visible: () => inSight,
          subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
        };
        const { settledTurn } = await loadWorktreeModule<
          typeof import("../../src/lib/settledWork.ts")
        >(root, "apps/mobile/src/lib/settledWork.ts");
        const start = settledTurn({
          settled: () => isSettled,
          subscribe: sight.subscribe,
          schedule: (run) => {
            let cancelled = false;
            void setImmediate().then(() => {
              if (!cancelled) run();
            });
            return () => {
              cancelled = true;
            };
          },
        });
        const visit = visitModule.followPlaylistRecommendations(session, {
          playlistId,
          sight,
          start: (signal) => Effect.runPromise(start, { signal }),
          subscribe: bus.onLibraryChange,
          wait: async () => {
            await setImmediate();
          },
        });
        stops.push(visit.dispose);
        controls.push({
          show: (value) => {
            inSight = value;
            for (const f of listeners) f();
          },
          settle: () => {
            isSettled = true;
            for (const f of listeners) f();
          },
        });
      } else {
        stops.push(
          bus.onLibraryChange((change) => {
            if (
              core.libraryChangeAffects(
                { tracks: true, favorites: true, playlists: [playlistId] },
                change,
              )
            )
              void session.renew();
          }),
        );
        controls.push({ show: () => {}, settle: () => {} });
        await session.renew();
      }
      await drain();
      return session;
    },
    show: (index: number, visible: boolean) => controls[index]!.show(visible),
    settle: () => {
      for (const control of controls) control.settle();
    },
    publish: (kind: "tracks" | "favorites" | "playlists", ids?: readonly number[], burst = true) =>
      bus.publishLibraryChange({ kind, ids, burst }),
    change: async (trace: boolean) => {
      for (const key of Object.keys(work) as (keyof typeof work)[]) work[key] = 0;
      measuring = true;
      tracing = trace;
      started = performance.now();
      bus.publishLibraryChange({ kind: "tracks", ids: [fixture.songIds.at(-1)!], burst: true });
      await drain();
      endTask();
      measuring = false;
      return sessions.map((session) => session.get().slots.map((offer) => offer?.track.id ?? null));
    },
    identities,
    close: () => {
      for (const stop of stops.splice(0)) stop();
      source?.dispose();
    },
  };
};
