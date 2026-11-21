import { Database } from "@wave/client";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Kotlin } from "../kotlin/kotlin.ts";
import { Playback } from "../playback/playback.ts";
import { YtMusic } from "../yt/ytMusic.ts";
import { YtFeatures } from "../yt/ytServices.ts";
import { createDesktopLinks } from "./links.ts";

export class DesktopLinks extends Context.Service<
  DesktopLinks,
  ReturnType<typeof createDesktopLinks>
>()("@wave/desktop/DesktopLinks") {}

export const desktopLinksLayer = (options: {
  readonly online: () => boolean;
  readonly writeClipboard: (text: string) => void;
  readonly fetch?: typeof globalThis.fetch;
}) =>
  Layer.effect(
    DesktopLinks,
    Effect.gen(function* () {
      const db = yield* Database;
      const kotlin = yield* Kotlin;
      const playback = yield* Playback;
      const yt = yield* YtMusic;
      const features = yield* YtFeatures;
      return createDesktopLinks({
        ...options,
        db,
        enabled: yt.enabled,
        call: (method, params) => Effect.runPromise(kotlin.call(method, params)),
        changed: playback.refresh,
        remember: (song) => yt.keep([song]),
        song: yt.song,
        start: async (song) => {
          if ("videoId" in song) {
            yt.keep([song]);
            await features.magicQueue.startStreamed(song);
          } else {
            const started = await features.startMagicQueue({
              scope: { kind: "songs" },
              ids: [song.id],
            });
            if (!started) throw new Error("The linked song cannot play here");
          }
        },
      });
    }),
  );
