import type { WaveSession } from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Kotlin } from "../kotlin/kotlin.ts";
import { createYtAccount, type YtAccountShape } from "./ytAccount.ts";
import type { YtBrowserSignIn } from "./ytBrowserSignIn.ts";
import { YtMusic } from "./ytMusic.ts";
import type { YtSessions } from "./ytSessionStore.ts";

/** The YouTube account in Wave's services (docs/spec-desktop.md, Sign-in). */
export class YtAccount extends Context.Service<YtAccount, YtAccountShape>()(
  "@wave/desktop/YtAccount",
) {}

export const ytAccountLayer = (options: {
  /** The session main keeps for the JVM, the same one its host methods serve. */
  readonly sessions: YtSessions;
  readonly online: () => boolean;
  readonly startSignIn: (email: string | null) => YtBrowserSignIn;
  readonly waveSession: () => WaveSession;
}) =>
  Layer.effect(
    YtAccount,
    Effect.gen(function* () {
      const kotlin = yield* Kotlin;
      const yt = yield* YtMusic;
      const account = createYtAccount({
        ...options,
        enabled: yt.enabled,
        call: (method, params) => Effect.runPromise(kotlin.call(method, params)),
      });
      yield* Effect.addFinalizer(() => Effect.sync(account.dispose));
      return account;
    }),
  );
