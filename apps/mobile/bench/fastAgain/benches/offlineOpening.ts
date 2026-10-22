import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { traceQueries } from "../../../src/library/db/testDatabase.ts";
import { loadDetailOpening } from "../detailOpeningReplay.ts";
import { percentiles } from "../measure.ts";
import type { FastAgainBench, ReadMeasurement } from "../types.ts";

// The API never answers. A deterministic transport fixture reports offline at
// 20 ms rather than burning the native client's 20,000 ms on every sample.
// Android advertises INTERNET but not VALIDATED: old native hasNetwork() allows
// the attempt, while the new opening online() check rejects it immediately.
const TRANSPORT_TIMEOUT_MS = 20;
const round = (n: number) => Number(n.toFixed(3));
export const bench: FastAgainBench = {
  name: "offlineOpening",
  async run(context) {
    const opening = await loadDetailOpening(context.root, context.fixture.db);
    const measurements: ReadMeasurement[] = [];
    for (const kind of ["artist", "album", "ytArtist"] as const) {
      const wall: number[] = [];
      const cpu: number[] = [];
      const sync: number[] = [];
      let requests = 0;
      let counts = { rowsRead: 0, statements: 0 };
      const run = async () => {
        const start = performance.now();
        const used = process.cpuUsage();
        const prepared = traceQueries(context.fixture.db, () => {
          if (kind === "album")
            return opening.album(context.fixture.albumId, context.fixture.now, false);
          if (kind === "artist") {
            const detail = Effect.runSync(
              opening.store.getArtist(context.fixture.targets.small.artistId),
            )!;
            Effect.runSync(opening.store.ytArtist(opening.core.identityKey(detail.artist.name)));
          }
          if (!opening.fixed) {
            Effect.runSync(opening.store.listSongs);
            if (kind === "ytArtist") {
              Effect.runSync(opening.store.listArtists);
              Effect.runSync(opening.store.listAlbums);
              Effect.runSync(opening.store.ytArtist("justice"));
            }
          }
          return null;
        });
        sync.push(performance.now() - start);
        counts = {
          rowsRead: prepared.queries.reduce((n, q) => n + q.rows, 0),
          statements: prepared.queries.length,
        };
        let note: string | null | undefined;
        if (opening.fixed) {
          note = opening.offlineView(kind, context.fixture.now);
          // Exercise the production execution check as well as the synchronous note.
          const result = await Effect.runPromise(
            Effect.result(
              opening.request(
                () => false,
                Effect.promise(() => {
                  requests++;
                  return new Promise<never>(() => {});
                }),
              ),
            ),
          );
          if (!Result.isFailure(result))
            throw new Error("offline opening unexpectedly got an answer");
        } else {
          const neverAnsweringApi = () => {
            requests++;
            return new Promise<never>(() => {});
          };
          const result = await Effect.runPromise(
            Effect.result(
              opening.request(
                () => false,
                Effect.tryPromise({
                  try: () =>
                    Promise.race([
                      neverAnsweringApi(),
                      new Promise<never>((_, reject) =>
                        setTimeout(() => reject({ reason: "offline" }), TRANSPORT_TIMEOUT_MS),
                      ),
                    ]),
                  catch: () => ({ reason: "offline" as const }),
                }),
              ),
            ),
          );
          if (!Result.isFailure(result)) throw new Error("fixture unexpectedly answered");
          const failed = { status: "ready" as const, saved: null, failure: "offline" as const };
          note =
            kind === "album"
              ? opening.core.ytLibraryAlbumView(failed, prepared.result!.context)?.note
              : kind === "artist"
                ? opening.core.ytArtistSectionView(failed, {
                    name: "Justice",
                    enabled: true,
                    now: context.fixture.now,
                    integrated: true,
                    inLibrary: () => true,
                  })?.note
                : opening.core.ytArtistPageView(failed, {
                    enabled: true,
                    now: context.fixture.now,
                    librarySong: () => null,
                    libraryAlbum: () => null,
                  }).note;
        }
        if (note !== "offline") throw new Error(`${kind} did not render offline: ${note}`);
        wall.push(performance.now() - start);
        const elapsed = process.cpuUsage(used);
        cpu.push((elapsed.user + elapsed.system) / 1000);
      };
      await run(); // warm separately
      wall.length = cpu.length = sync.length = 0;
      requests = 0;
      for (let i = 0; i < context.runs; i++) await run();
      const source =
        kind === "album"
          ? "ytmusic/albumSection.ts"
          : kind === "artist"
            ? "ytmusic/artistSection.ts"
            : "ytmusic/artistPage.ts";
      measurements.push({
        read: `${kind}/offlineNote`,
        ...percentiles(wall),
        cpuMs: round(cpu.reduce((a, b) => a + b, 0) / cpu.length),
        ...counts,
        longestSyncTaskMs: round(Math.max(...sync)),
        notifications: 0,
        resultKey: "offline",
        details: {
          phase:
            "opening reads to offline note with fake API that never answers; data/effect replay, not RN paint",
          source: `apps/mobile/src/${source}`,
          sourceSha256: createHash("sha256")
            .update(readFileSync(resolve(context.root, "apps/mobile/src", source)))
            .digest("hex"),
          requestsPerOpening: requests / context.runs,
          fixtureTransportTimeoutMs: TRANSPORT_TIMEOUT_MS,
          connectivityFixture: { internetCapability: true, validated: false },
          nativeRequestTimeoutMs: 20000,
          timeoutSource:
            "apps/mobile/modules/wave-native/android/src/main/java/expo/modules/wavenative/yt/YtClient.kt",
          limit:
            "20 ms is an injected transport deadline, not a measured native timeout or phone speedup; after requires no transport response",
        },
      });
    }
    return measurements;
  },
};
