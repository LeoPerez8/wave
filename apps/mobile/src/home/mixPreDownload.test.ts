import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import type { BlendedDiscoverMix, DiscoverMixesSection } from "@wave/core";

// The real list keeping; the native job and the log are the boundary.
const boundary = `data:text/javascript,${encodeURIComponent(`
  export const handed = [];
  export const WaveYtMusic = { schedulePreDownload: async (ids) => { handed.push(ids); } };
  export const appLog = () => {};
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/native/waveYtMusic" || specifier === "@/log/appLog")
      return { url: boundary, shortCircuit: true };
    return next(specifier, context);
  },
});
const { noteMixesShown } = await import("./mixPreDownload.ts");
const { handed } = (await import(boundary)) as { handed: string[][] };
hooks.deregister();

const mix = (id: string, videoId: string): BlendedDiscoverMix =>
  ({
    id,
    seed: { kind: "artist", name: id },
    songs: [
      {
        source: "stream",
        song: { videoId, title: videoId, artists: [], album: null, durationMs: null },
      },
    ],
  }) as unknown as BlendedDiscoverMix;
const mixes = (...list: BlendedDiscoverMix[]): DiscoverMixesSection => ({
  kind: "mixes",
  mixes: list,
  updating: false,
  failed: false,
});

test("only a mix row Home draws is fetched ahead, even when the empty-Library exception builds it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // Artist mixes removed, built for the Magic Queue of an empty Library.
  noteMixesShown("artist-mixes", mixes(mix("a", "artist-song")), false);
  noteMixesShown("genre-mixes", mixes(mix("g", "genre-song")), true);
  t.mock.timers.tick(2_000);
  assert.deepEqual(handed.at(-1), ["genre-song"]);

  // Added back, it's drawn and fetched ahead too.
  noteMixesShown("artist-mixes", mixes(mix("a", "artist-song")), true);
  t.mock.timers.tick(2_000);
  assert.deepEqual(handed.at(-1), ["artist-song", "genre-song"]);
});
