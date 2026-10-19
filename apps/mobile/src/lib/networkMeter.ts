/**
 * The network a run uses, for the app log (docs/spec.md, App log): a mix
 * build or a Magic Queue batch runs inside `withNetworkLog`, which writes one
 * line when it ends (Core's `networkUseLine`) with how long it took and, per
 * host, its requests and bytes. YouTube Music's reads count natively, as on
 * the wire (the reads take the run's meter, `ytNetworkMeter`); Deezer's
 * lookups count their answers here (`countAnswer`). Runs going on at once
 * each count their own.
 */
import {
  NO_NETWORK_USE,
  answerBytes,
  networkUseLine,
  withNetworkUse,
  type NetworkHost,
  type NetworkUse,
} from "@wave/core";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { appLog } from "@/log/appLog";
import { WaveYtMusic } from "@/native/waveYtMusic";

const TAG = "WaveNetwork";

/** A run being measured: its native YouTube Music meter, and what JS counted. */
interface Meter {
  readonly yt: string;
  use: NetworkUse;
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

/**
 * Counts one request to [host] answered with [body] (its Content-Length when
 * given, else its size: Core's `answerBytes`) on the run being measured.
 */
export const countAnswer = (
  host: Exclude<NetworkHost, "ytMusic">,
  contentLength: string | null,
  body: string,
): Effect.Effect<void> =>
  Effect.map(Effect.service(CurrentMeter), (meter) => {
    if (meter === null) return;
    meter.use = withNetworkUse(meter.use, host, {
      requests: 1,
      bytes: answerBytes(contentLength, body),
    });
  });

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
 * when that says something ("4 mixes"), and [used] is told what it used
 * (the harvest counts its mobile data with it).
 */
export const withNetworkLog = <A, E, R>(
  what: string,
  effect: Effect.Effect<A, E, R>,
  outcome?: (value: A) => string | undefined,
  used?: (use: NetworkUse) => void,
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const startedAt = Date.now();
    const meter: Meter = { yt: WaveYtMusic.startNetworkMeter(), use: NO_NETWORK_USE };
    return effect.pipe(
      Effect.provideService(CurrentMeter, meter),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          const ended = Exit.isSuccess(exit) ? outcome?.(exit.value) : endedBy(exit.cause);
          const use = { ...meter.use, ytMusic: WaveYtMusic.takeNetworkUse(meter.yt) };
          const durationMs = Date.now() - startedAt;
          used?.(use);
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
