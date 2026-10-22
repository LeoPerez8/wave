/** #593: actual ti derivation against the stepped shared-profile implementation. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import type { TasteProfile } from "@wave/core";
import { loadLibraryStore } from "../store.ts";
import { measureCooperative } from "../cooperative.ts";
import type { FastAgainBench } from "../types.ts";

export const profileKey = (profile: TasteProfile) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        at: profile.at,
        songs: [...profile.songs],
        artists: [...profile.artists],
        genres: [...profile.genres],
      }),
    )
    .digest("hex");
export const bench: FastAgainBench = {
  name: "tasteProfile",
  async run(context) {
    const store = await loadLibraryStore(context.root, context.fixture.db);
    const core = await context.loadModule<typeof import("@wave/core")>(
      "packages/core/src/index.ts",
    );
    const path = "apps/mobile/src/playback/tasteDerivation.ts";
    const history = Effect.runSync(store.tasteHistory);
    const convert = core.magicLibrarySongs(Effect.runSync(store.listArtists));
    const byId = new Map(
      Effect.runSync(store.listSongs).map((song) => [String(song.id), convert(song)]),
    );
    if (existsSync(resolve(context.root, path))) {
      const { deriveTaste } =
        await context.loadModule<typeof import("../../../src/playback/tasteDerivation.ts")>(path);
      const { runSteps } = await context.loadModule<typeof import("../../../src/lib/stepped.ts")>(
        "apps/mobile/src/lib/stepped.ts",
      );
      return [
        await measureCooperative(
          context.fixture.db,
          "firstDerivation",
          context.runs,
          (turn) => deriveTaste(store, turn, context.fixture.now),
          profileKey,
        ),
        await measureCooperative(
          context.fixture.db,
          "scoreCpuOnly",
          context.runs,
          (turn) =>
            runSteps(
              core.tasteProfileSteps(history, (id) => byId.get(id), context.fixture.now),
              turn,
            ),
          profileKey,
        ),
      ];
    }
    return [
      context.measure(
        "scoreCpuOnly",
        () => core.tasteProfile(history, (id) => byId.get(id), context.fixture.now),
        {
          resultKey: profileKey,
          details: {
            source:
              "ti public Core tasteProfile with already-read inputs; excludes source SQL and mapping",
          },
        },
      ),
      context.measure(
        "firstDerivation",
        () => {
          const sourceHistory = Effect.runSync(store.tasteHistory);
          const songs = Effect.runSync(store.listSongs);
          const sourceConvert = core.magicLibrarySongs(Effect.runSync(store.listArtists));
          const sourceById = new Map(songs.map((song) => [String(song.id), sourceConvert(song)]));
          return core.tasteProfile(sourceHistory, (id) => sourceById.get(id), context.fixture.now);
        },
        {
          resultKey: profileKey,
          details: {
            source:
              "ti TasteProfile.live.derive: history, songs, artists, complete map and scores in one synchronous task",
            semanticEquality: "all profile scores and map insertion order, exact IEEE numbers",
          },
        },
      ),
    ];
  },
};
