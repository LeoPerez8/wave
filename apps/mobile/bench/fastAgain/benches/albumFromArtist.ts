import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import { traceQueries } from "../../../src/library/db/testDatabase.ts";
import { loadArtistOpening } from "../artistOpeningReplay.ts";
import { seedArtistOpening } from "../artistOpeningFixture.ts";
import { loadDetailOpening } from "../detailOpeningReplay.ts";
import type { FastAgainBench } from "../types.ts";

const normalizeLegacy = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeLegacy);
  if (value !== null && typeof value === "object") {
    const row = value as Record<string, unknown>;
    const normalized = Object.fromEntries(
      Object.entries(row)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, normalizeLegacy(v)]),
    );
    if ("artist" in row && "durationMs" in row) normalized.explicit = row.explicit ?? "unknown";
    return Object.fromEntries(
      Object.entries(normalized).toSorted(([a], [b]) => a.localeCompare(b)),
    );
  }
  return value;
};
const key = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(normalizeLegacy(value)))
    .digest("hex");
export const bench: FastAgainBench = {
  name: "albumFromArtist",
  async run(context) {
    const opening = await loadDetailOpening(context.root, context.fixture.db);
    const artist = await loadArtistOpening(context.root, context.fixture.db);
    const restore = seedArtistOpening(context.fixture, artist);
    try {
      const id = context.fixture.albumId;
      const run = () => opening.album(id, context.fixture.now);
      const { result, queries } = traceQueries(context.fixture.db, run);
      const songs = result.detail.tracks.map((track) => ({
        videoId: `local-${track.id}`,
        title: track.title,
        artists: [track.artist],
        album: track.album,
        durationMs: track.durationMs,
        artworkUrl: null,
        albumId: null,
        explicit: false,
      }));
      songs.push({ ...songs[0]!, videoId: "remote-only", title: "Only online" });
      const files = [
        "app/library/album/[id].tsx",
        "ytmusic/albumSection.ts",
        "ytmusic/libraryFinder.ts",
        "ytmusic/YtSongList.tsx",
      ];
      const provenance = files.map((file) => ({
        file: `apps/mobile/src/${file}`,
        sha256: createHash("sha256")
          .update(readFileSync(resolve(context.root, "apps/mobile/src", file)))
          .digest("hex"),
      }));
      return [
        context.measure(
          "localTracklist",
          () => Effect.runSync(opening.store.getAlbum(id))?.tracks,
          {
            resultKey: key,
            details: {
              phase:
                "actual album query to local track data; local fallback exists in both historical routes",
              provenance,
            },
          },
        ),
        context.measure("openingWithColdFollowers", () => run().detail.tracks, {
          resultKey: key,
          details: {
            phase:
              "local track data plus synchronous companion opening reads; not an RN paint or request-answer wait",
            source:
              "faithful replay of selected-worktree source; real LibraryStore/Core; cold shared query each run",
            songRows: queries
              .filter((q) => /(?:\"tracks\"|tracks)\.(?:\"title\"|title)/.test(q.sql))
              .reduce((n, q) => n + q.rows, 0),
            requestsStartedBeforeSettlement: result.requests,
            deferred: opening.fixed
              ? "finder and request both wait for local content and settlement"
              : "eager shared follower and integrated request; local fallback never awaited YouTube",
            reads: queries,
            provenance,
          },
        }),
        context.measure("joinedTracklist", () => opening.answer(result, songs), {
          resultKey: key,
          details: {
            phase:
              "after the controlled YouTube answer; includes deferred cold finder, not network latency",
            semanticEquality:
              "complete track entries, local identities and online addition (legacy absent explicit means unknown); rows initially shown stay first after the fix",
          },
        }),
      ];
    } finally {
      restore();
    }
  },
};
