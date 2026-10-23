import * as Effect from "effect/Effect";
import { createPlaylistReplay } from "../playlistReplay.ts";
import { measurePlaylistOperation } from "../playlistMeasure.ts";
import type { BenchMeasurement, FastAgainBench } from "../types.ts";

export const bench: FastAgainBench = {
  name: "playlistRenewal",
  async run(context) {
    const results: BenchMeasurement[] = [];
    for (const mounted of [1, 2]) {
      let replay = await createPlaylistReplay(context.root, context.fixture);
      if (replay === null)
        return [
          {
            read: "hiddenBurst/1Mounted",
            status: "unavailable",
            reason: "Playlist recommendations did not exist",
          },
        ];
      const reset = async () => {
        replay!.close();
        replay = (await createPlaylistReplay(context.root, context.fixture))!;
      };
      // Each opening sample is a fresh visit/source. Module loading and fixture creation are outside timing.
      const initial = replay;
      const prepare = async () => {
        await reset();
      };
      // Measurement takes a stable forwarding proxy while the sample's visit/source gets replaced.
      const proxy = new Proxy(initial, { get: (_target, key) => Reflect.get(replay!, key) });
      try {
        results.push(
          await measurePlaylistOperation(
            `opening/beforeSettled/${mounted}Mounted`,
            context.runs,
            proxy,
            async () => {
              const content = [];
              for (let i = 0; i < mounted; i++) {
                content.push(
                  (await Effect.runPromise(replay!.store.getPlaylist(context.fixture.playlistId)))!
                    .items,
                );
                await replay!.mount({ settled: false });
              }
              return content;
            },
            prepare,
          ),
        );
        await reset();
        for (let i = 0; i < mounted; i++) await replay.mount();
        results.push(
          await measurePlaylistOperation(
            `hiddenBurst/${mounted}Mounted`,
            context.runs,
            proxy,
            async () => {
              for (let i = 0; i < 12; i++) {
                replay!.publish("tracks");
                replay!.publish("favorites");
              }
              await replay!.drain();
              return replay!.identities();
            },
            async () => {
              for (let i = 0; i < mounted; i++) replay!.show(i, false);
            },
          ),
        );
        results.push(
          await measurePlaylistOperation(
            `visibleCatchUp/${mounted}Mounted`,
            context.runs,
            proxy,
            async () => {
              for (let i = 0; i < mounted; i++) replay!.show(i, true);
              await replay!.drain();
              return replay!.identities();
            },
            async () => {
              for (let i = 0; i < mounted; i++) replay!.show(i, false);
              replay!.publish("tracks");
              await replay!.drain();
            },
          ),
        );
        results.push(
          await measurePlaylistOperation(
            `visibleBurst/${mounted}Mounted`,
            context.runs,
            proxy,
            async () => {
              for (let i = 0; i < 12; i++) {
                replay!.publish("tracks");
                replay!.publish("favorites");
              }
              await replay!.drain();
              return replay!.identities();
            },
          ),
        );
      } finally {
        replay.close();
      }
    }
    for (const graph of ["warm", "cold"] as const) {
      let replay = (await createPlaylistReplay(context.root, context.fixture, graph))!;
      if (replay === null) continue;
      const proxy = new Proxy(replay, { get: (_target, key) => Reflect.get(replay, key) });
      try {
        results.push(
          await measurePlaylistOperation(
            `opening/settled/${graph}Graph`,
            context.runs,
            proxy,
            async () => {
              await replay.mount();
              return replay.identities();
            },
            async () => {
              replay.close();
              replay = (await createPlaylistReplay(context.root, context.fixture, graph))!;
            },
          ),
        );
      } finally {
        replay.close();
      }
    }
    return results;
  },
};
