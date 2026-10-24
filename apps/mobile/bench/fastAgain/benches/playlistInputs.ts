import { createPlaylistReplay } from "../playlistReplay.ts";
import { measurePlaylistOperation } from "../playlistMeasure.ts";
import type { BenchMeasurement, FastAgainBench } from "../types.ts";

export const bench: FastAgainBench = {
  name: "playlistInputs",
  async run(context) {
    const results: BenchMeasurement[] = [];
    for (const graph of ["null", "warm"] as const) {
      const replay = await createPlaylistReplay(context.root, context.fixture, graph);
      if (replay === null)
        return [
          {
            read: "input/cold",
            status: "unavailable",
            reason: "Playlist recommendations did not exist",
          },
        ];
      try {
        let input = await replay.input();
        if (graph === "null") {
          const project = async () => {
            const { playlist, library, librarySongs, favoriteVideos, feedback } =
              await replay.input();
            return { playlist, library, librarySongs, favoriteVideos, feedback };
          };
          results.push(
            await measurePlaylistOperation(
              "input/cold",
              context.runs,
              replay,
              project,
              async () => {
                replay.forget();
              },
            ),
          );
          results.push(await measurePlaylistOperation("input/warm", context.runs, replay, project));
          input = await replay.input();
        }
        results.push(
          await measurePlaylistOperation(
            `rank/warmInput/${graph}Graph`,
            context.runs,
            replay,
            async () => replay.rank(input),
          ),
        );
      } finally {
        replay.close();
      }
    }
    return results;
  },
};
