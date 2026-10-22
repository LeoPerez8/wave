import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import * as Effect from "effect/Effect";
import type { StreamedArtistLink } from "@wave/core";

import type { ArtistRow } from "../../../src/library/LibraryStore.ts";
import { traceQueries } from "../../../src/library/db/testDatabase.ts";
import { createArtistLinkFixture } from "../artistLinkFixture.ts";
import { percentiles } from "../measure.ts";
import { loadLibraryStore } from "../store.ts";
import type { BenchMeasurement, FastAgainBench } from "../types.ts";

const round = (n: number) => Number(n.toFixed(3));
const destination = (link: StreamedArtistLink<ArtistRow> | undefined): string => {
  assert.equal(link?.kind, "open");
  if (link?.kind !== "open") throw new Error("expected one artist");
  return link.target.kind === "library"
    ? `library:${link.target.artist.id}`
    : `${link.target.kind}:${link.target.name}`;
};

export const bench: FastAgainBench = {
  name: "streamedArtistLink",
  async run(context) {
    const sourcePath = join(context.root, "apps/mobile/src/ytmusic/streamedArtist.ts");
    if (!existsSync(sourcePath))
      return [
        {
          read: "lineAvailability/cold",
          status: "unavailable",
          reason: "Streamed artist links did not exist in this revision",
        },
      ];
    const source = readFileSync(sourcePath, "utf8");
    const core = await context.loadModule<typeof import("@wave/core")>(
      "packages/core/src/index.ts",
    );
    const current = typeof core.resolveStreamedArtistLink === "function";
    const legacyCache = current
      ? null
      : await context.loadModule<typeof import("../../../src/lib/versionedCache.ts")>(
          "apps/mobile/src/lib/versionedCache.ts",
        );
    if (!current) {
      // The hook cannot load without native/React. Guard its real gate before replaying its reads.
      assert.match(source, /artists === null \|\| context === undefined \? undefined/);
      assert.match(
        source,
        /build: \(\) => appRuntime.runPromise\(listArtists\).then\(libraryArtistFinder\)/,
      );
    }
    const artists = ({ 1000: 500, 12000: 5000, 50000: 20000 } as const)[context.fixture.size];
    const fixture = await createArtistLinkFixture(artists);
    try {
      const store = await loadLibraryStore(context.root, fixture.db);
      const lookupModule = current
        ? await context.loadModule<typeof import("../../../src/library/artistLookup.ts")>(
            "apps/mobile/src/library/artistLookup.ts",
          )
        : null;
      const warmFinder = core.libraryArtistFinder(Effect.runSync(store.listArtists));
      assert.equal(
        Effect.runSync(store.listArtists).length,
        artists,
        "store startup changed the active artist count",
      );
      const newLookup = (read: <A>(work: Effect.Effect<A, unknown>) => A) =>
        lookupModule?.createArtistLinkLookup({
          version: () => 1,
          readPage: async (after) => read(store.artistNamesForLink(after)),
          readArtist: async (id) => read(store.linkRows({ artistId: id })).artist,
        });
      const warmLookup = newLookup(Effect.runSync);
      await warmLookup?.read([fixture.last.name], new AbortController().signal);
      const measurements: BenchMeasurement[] = [];
      const scenarios = [
        "lineAvailability/cold",
        "lineAvailability/warm",
        "lineAvailability/offline",
        "tapLookup/first",
        "tapLookup/middle",
        "tapLookup/last",
        "tapLookup/missing",
        "tapLookup/warm",
        "tapLookup/offline",
        "completeLookup/last",
        "completeLookup/missing",
      ];
      for (const read of scenarios) {
        const person = read.endsWith("/first")
          ? fixture.first
          : read.endsWith("/middle")
            ? fixture.middle
            : fixture.last;
        const offline = read.endsWith("/offline");
        const missing = read.endsWith("/missing") || (offline && read.startsWith("tapLookup/"));
        const name = missing ? "Absent from the Library" : person.name;
        const expected = missing ? `yt:${name}` : `library:${person.id}`;
        const run = async (trace: boolean) => {
          let rowsRead = 0;
          let statements = 0;
          let notifications = 0;
          let outcome = "not-needed";
          const steps: number[] = [];
          const sync = <A>(work: () => A): A => {
            const start = performance.now();
            try {
              return work();
            } finally {
              steps.push(performance.now() - start);
            }
          };
          const effect = <A>(work: Effect.Effect<A, unknown>): A =>
            sync(() => {
              if (!trace) return Effect.runSync(work);
              const measured = traceQueries(fixture.db, () => Effect.runSync(work));
              rowsRead += measured.queries.reduce((sum, q) => sum + q.rows, 0);
              statements += measured.queries.length;
              return measured.result;
            });
          const lookup = read.endsWith("/warm") ? warmLookup : newLookup(effect);
          const stop = lookup?.subscribe(() => {
            notifications++;
          });
          const here = { enabled: true, here: "/library/songs" };
          const boundedRead = async (names: readonly string[], signal: AbortSignal) => {
            outcome = "reading";
            const abort = () => {
              if (outcome === "reading") outcome = "deadline";
            };
            signal.addEventListener("abort", abort, { once: true });
            try {
              const find = await lookup!.read(names, signal);
              if (outcome === "reading") outcome = "completed";
              return find;
            } finally {
              signal.removeEventListener("abort", abort);
            }
          };
          let link: StreamedArtistLink<ArtistRow> | undefined;
          try {
            if (read === "lineAvailability/cold" || read === "lineAvailability/offline") {
              if (current)
                link = sync(() =>
                  core.streamedArtistLink([name], { ...here, libraryArtist: lookup!.find }),
                );
              else {
                const cache = legacyCache!.makeVersionedCache<
                  ((name: string) => ArtistRow | null) | null
                >({
                  version: { get: () => 1, subscribe: () => () => {} },
                  initial: null,
                  build: async () =>
                    sync(() => core.libraryArtistFinder(effect(store.listArtists))),
                });
                assert.equal(cache.get(), null, "ti's initial hook context must be unread");
                let stopCache: (() => void) | undefined;
                try {
                  link = await new Promise<StreamedArtistLink<ArtistRow> | undefined>((resolve) => {
                    stopCache = cache.subscribe(() => {
                      notifications++;
                      resolve(
                        sync(() =>
                          core.streamedArtistLink([name], { ...here, libraryArtist: cache.get()! }),
                        ),
                      );
                    });
                  });
                } finally {
                  stopCache?.();
                }
              }
            } else if (read.startsWith("completeLookup/")) {
              if (current) {
                await lookup!.read([name], new AbortController().signal);
                outcome = "completed";
                link = sync(() =>
                  core.streamedArtistLink([name], { ...here, libraryArtist: lookup!.find }),
                );
                link = await core.resolveStreamedArtistLink(
                  link!,
                  { ...here, libraryArtist: lookup!.find },
                  {
                    online: !offline,
                    read: async () => assert.fail("complete lookup already cached"),
                  },
                );
              } else
                link = sync(() =>
                  core.streamedArtistLink([name], {
                    ...here,
                    libraryArtist: core.libraryArtistFinder(effect(store.listArtists)),
                  }),
                );
            } else if (read === "lineAvailability/warm" || read === "tapLookup/warm" || !current) {
              const libraryArtist = current ? lookup!.find : warmFinder;
              link = sync(() => core.streamedArtistLink([name], { ...here, libraryArtist }));
              if (current && read === "tapLookup/warm")
                link = await core.resolveStreamedArtistLink(
                  link!,
                  { ...here, libraryArtist },
                  { online: !offline, read: async () => assert.fail("warm link read") },
                );
            } else {
              const tapContext = { ...here, libraryArtist: lookup!.find };
              link = sync(() => core.streamedArtistLink([name], tapContext));
              link = await core.resolveStreamedArtistLink(link!, tapContext, {
                online: !offline,
                read: boundedRead,
              });
            }
            const key = destination(link);
            if (
              (read === "lineAvailability/cold" || read === "lineAvailability/offline") &&
              current
            )
              assert.equal(key, `unread:${name}`);
            else if (current && read.startsWith("tapLookup/") && key !== expected) {
              assert.equal(
                outcome,
                "deadline",
                "a completed lookup must keep destination equality",
              );
              assert.equal(
                key,
                `yt:${name}`,
                "only deadline fallback may differ from the complete lookup",
              );
              assert.equal(
                lookup!.find(name),
                undefined,
                "a known Library destination must never fall back",
              );
            } else assert.equal(key, expected, `${artists} artists: ${read} wrong destination`);
            if (current && offline && key.startsWith("yt:"))
              assert.ok(
                link?.kind === "open" && link.target.kind === "yt" && link.target.offline === true,
              );
            return {
              resultKey: read.startsWith("lineAvailability/") ? String(link !== undefined) : key,
              destination: key,
              outcome,
              link,
              rowsRead,
              statements,
              notifications,
              steps,
            };
          } finally {
            stop?.();
          }
        };
        await run(false);
        const traced = await run(true);
        const wall: number[] = [];
        const steps: number[] = [];
        const destinations: string[] = [];
        const outcomes: string[] = [];
        let cpuMicros = 0;
        for (let i = 0; i < context.runs; i++) {
          const cpu = process.cpuUsage();
          const start = performance.now();
          const result = await run(false);
          wall.push(performance.now() - start);
          const used = process.cpuUsage(cpu);
          cpuMicros += used.user + used.system;
          steps.push(...result.steps);
          destinations.push(result.destination);
          outcomes.push(result.outcome);
          if (!read.startsWith("tapLookup/")) assert.equal(result.resultKey, traced.resultKey);
        }
        measurements.push({
          read,
          ...percentiles(wall),
          cpuMs: round(cpuMicros / 1000 / context.runs),
          rowsRead: traced.rowsRead,
          statements: traced.statements,
          longestSyncTaskMs: round(Math.max(...steps)),
          notifications: traced.notifications,
          ...(read.startsWith("tapLookup/") ? {} : { resultKey: traced.resultKey }),
          details: {
            artists,
            songs: fixture.songs,
            firstFrameLink:
              current || !["lineAvailability/cold", "lineAvailability/offline"].includes(read),
            online: !offline,
            tracedOutcome: traced.outcome,
            timedOutcomes: outcomes,
            tracedActualLink: traced.link,
            timedDestinations: destinations,
            expectedDestination: expected,
            deadlineFallbacks: outcomes.filter((outcome) => outcome === "deadline").length,
            destinationMismatches: destinations.filter((key) => key !== expected).length,
            completedLookups: outcomes.filter((outcome) => outcome === "completed").length,
            deadlineMs:
              current && read.startsWith("tapLookup/") ? core.STREAMED_ARTIST_WAIT_MS : null,
            source: current
              ? "selected Core + production createArtistLinkLookup + real LibraryStore reads"
              : "faithful native-hook replay: selected makeVersionedCache + LibraryStore.listArtists + libraryArtistFinder + streamedArtistLink; tap uses the resulting warm finder",
            timing:
              "cold line = read/finder/Core cost until link can exist; excludes React commit/frame, native scheduling and opening DB; after tap includes real task yields and the 500 ms deadline",
            longestSyncTask:
              "max timed synchronous read/Core segment (before read+finder combined); bounded-page normalization and microtask bookkeeping excluded; not a Hermes/phone event-loop measurement",
            notifications:
              "one real lookup/versioned-cache subscriber; no SQL store writes; React render not replayed",
            equivalence:
              "completeLookup compares exact destination keys across revisions; bounded tap reports completed/deadline outcomes separately from destination equality (a missing artist may reach the expected YT target by timeout), never an unread or missing link",
            trace:
              "SQL tracing is outside timed samples; its deadline can expire earlier because EXPLAIN adds overhead. Traced work/target may differ from timed bounded taps; completeLookup work is deterministic",
          },
        });
      }
      return measurements;
    } finally {
      fixture.close();
    }
  },
};
