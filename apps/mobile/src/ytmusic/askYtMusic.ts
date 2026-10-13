import * as Effect from "effect/Effect";
import type * as Result from "effect/Result";

import { appRuntime } from "@/library/runtime";

import { YtMusic } from "./YtMusic";

/**
 * Runs a YT Music request ([use] on the `YtMusic` service) on the app runtime,
 * resolving its answer or why there wasn't one; it never rejects. The one way
 * screens and hooks ask YT Music. (Kept apart from `YtMusic.ts`, which the
 * runtime itself imports.)
 */
export const askYtMusic = <A, E>(
  use: (ytMusic: YtMusic["Service"]) => Effect.Effect<A, E>,
): Promise<Result.Result<A, E>> =>
  appRuntime.runPromise(
    Effect.result(
      Effect.gen(function* () {
        const ytMusic = yield* YtMusic;
        return yield* use(ytMusic);
      }),
    ),
  );
