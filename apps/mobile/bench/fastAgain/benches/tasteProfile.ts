/** #593: actual ti derivation against the stepped shared-profile implementation. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import type { MagicSong, TasteHistory, TasteProfile } from "@wave/core";
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
const inputKey = (input: {
  magic: readonly MagicSong[];
  playable: readonly MagicSong[];
  history: TasteHistory;
}) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
export const bench: FastAgainBench = {
  name: "tasteProfile",
  async run(context) {
    const store = await loadLibraryStore(context.root, context.fixture.db);
    const core = await context.loadModule<typeof import("@wave/core")>(
      "packages/core/src/index.ts",
    );
    const path = "apps/mobile/src/playback/tasteDerivation.ts";
    const scoringHistory = Effect.runSync(store.tasteHistory);
    const scoringConvert = core.magicLibrarySongs(Effect.runSync(store.listArtists));
    const scoringById = new Map(
      Effect.runSync(store.listSongs).map((song) => [String(song.id), scoringConvert(song)]),
    );
    if (existsSync(resolve(context.root, path))) {
      const { deriveTaste, readTasteLibrary, readTasteHistory } =
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
          "inputSnapshot",
          context.runs,
          (turn) =>
            Effect.gen(function* () {
              const library = yield* readTasteLibrary(store, turn);
              const history = yield* readTasteHistory(store, turn);
              return { magic: library.magic, playable: library.playable, history };
            }),
          inputKey,
        ),
        await measureCooperative(
          context.fixture.db,
          "scoreCpuOnly",
          context.runs,
          (turn) =>
            runSteps(
              core.tasteProfileSteps(
                scoringHistory,
                (id) => scoringById.get(id),
                context.fixture.now,
              ),
              turn,
            ),
          profileKey,
        ),
      ];
    }
    const inputs = () => {
      const history = Effect.runSync(store.tasteHistory);
      const songs = Effect.runSync(store.listSongs);
      const convert = core.magicLibrarySongs(Effect.runSync(store.listArtists));
      return {
        magic: songs.map(convert),
        playable: songs.filter((song) => song.path !== null).map(convert),
        history,
      };
    };
    return [
      await measureCooperative(
        context.fixture.db,
        "firstDerivation",
        context.runs,
        (turn) =>
          turn.pipe(
            Effect.andThen(
              Effect.sync(() => {
                // ti TasteProfile.live: the selected revision's real store, mapper and scorer.
                const history = Effect.runSync(store.tasteHistory);
                const songs = Effect.runSync(store.listSongs);
                const convert = core.magicLibrarySongs(Effect.runSync(store.listArtists));
                const byId = new Map(songs.map((song) => [String(song.id), convert(song)]));
                return core.tasteProfile(history, (id) => byId.get(id), context.fixture.now);
              }),
            ),
          ),
        profileKey,
      ),
      await measureCooperative(
        context.fixture.db,
        "inputSnapshot",
        context.runs,
        (turn) => turn.pipe(Effect.andThen(Effect.sync(inputs))),
        inputKey,
      ),
      await measureCooperative(
        context.fixture.db,
        "scoreCpuOnly",
        context.runs,
        (turn) =>
          turn.pipe(
            Effect.andThen(
              Effect.sync(() =>
                core.tasteProfile(scoringHistory, (id) => scoringById.get(id), context.fixture.now),
              ),
            ),
          ),
        profileKey,
      ),
    ];
  },
};
