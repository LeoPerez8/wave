import { registerTimingBackground, timingBackgroundChanged } from "./timing";
/**
 * The network a run uses, for the app log (docs/spec.md, App log): a mix
 * build or a Magic Queue batch runs inside `withNetworkLog`, which writes one
 * line when it ends (Core's `networkUseLine`) with how long it took and, per
 * host, its requests and bytes. YouTube Music's reads count natively, as on
 * the wire (the reads take the run's meter, `ytNetworkMeter`). Concurrent
 * runs each count their own requests. Recommendations make no Deezer calls.
 */
import { NO_NETWORK_USE, networkUseLine } from "@wave/core";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { appLog } from "@/log/appLog";
import { WaveYtMusic } from "@/native/waveYtMusic";

const timingRuns = new Map<string, number>();
registerTimingBackground("magicQueue", () =>
  [...timingRuns.keys()].some((what) => what.startsWith("Magic Queue"))
    ? "Magic Queue batch"
    : null,
);

const TAG = "WaveNetwork";

/** A run being measured: its native YouTube Music meter. */
interface Meter {
  readonly yt: string;
}

/** The run being measured, if any: inherited by the fibers it starts. */
const CurrentMeter = Context.Reference<Meter | null>("@wave/mobile/lib/networkMeter/CurrentMeter", {
  defaultValue: () => null,
});

/** The native meter YouTube Music reads go out on: undefined outside a measured run. */
export const ytNetworkMeter: Effect.Effect<string | undefined> = Effect.map(
  Effect.service(CurrentMeter),
  (meter) => meter?.yt,
);

/** How a run that didn't finish ended, as its line says it. */
const endedBy = (cause: Cause.Cause<unknown>): string =>
  Cause.hasInterrupts(cause)
    ? "stopped"
    : Cause.isTimeoutError(Cause.squash(cause))
      ? "timed out"
      : "failed";

/**
 * Runs [effect], measured: when it ends (done, failed, timed out or
 * stopped), the app log gets [what]'s line, with [outcome] of what it gave
 * when that says something ("4 mixes").
 */
export const withNetworkLog = <A, E, R>(
  what: string,
  effect: Effect.Effect<A, E, R>,
  outcome?: (value: A) => string | undefined,
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const startedAt = Date.now();
    const meter: Meter = { yt: WaveYtMusic.startNetworkMeter() };
    timingRuns.set(what, (timingRuns.get(what) ?? 0) + 1);
    timingBackgroundChanged();
    return effect.pipe(
      Effect.provideService(CurrentMeter, meter),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          const count = (timingRuns.get(what) ?? 1) - 1;
          if (count === 0) timingRuns.delete(what);
          else timingRuns.set(what, count);
          const ended = Exit.isSuccess(exit) ? outcome?.(exit.value) : endedBy(exit.cause);
          const use = { ...NO_NETWORK_USE, ytMusic: WaveYtMusic.takeNetworkUse(meter.yt) };
          const durationMs = Date.now() - startedAt;
          appLog(
            "info",
            TAG,
            networkUseLine({
              what,
              durationMs,
              use,
              ...(ended === undefined ? {} : { outcome: ended }),
            }),
          );
        }),
      ),
    );
  });
