/**
 * Kotlin: the shared Kotlin (`packages/kotlin-shared`) as a service of main, run in the bundled
 * JVM main supervises. Its calls fail with the codes the phone's module rejects with.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { SongTags } from "../../shared/tags.ts";
import type { KotlinMethod, KotlinMethods } from "./protocol.ts";
import {
  KotlinError,
  superviseKotlin,
  type KotlinSupervisor,
  type KotlinSupervisorOptions,
} from "./supervisor.ts";

export interface KotlinShape {
  /** Any method `WaveDesktop.handle` answers. */
  readonly call: <M extends KotlinMethod>(
    method: M,
    params: KotlinMethods[M]["params"],
  ) => Effect.Effect<KotlinMethods[M]["result"], KotlinError>;
  /** The tags of the audio file at `path`, as the phone's scan reads them. */
  readonly readTags: (path: string) => Effect.Effect<SongTags, KotlinError>;
}

export class Kotlin extends Context.Service<Kotlin, KotlinShape>()("@wave/desktop/Kotlin") {}

const asError = (error: unknown) =>
  error instanceof KotlinError ? error : new KotlinError("ERR_UNEXPECTED", String(error));

const kotlinOf = (jvm: KotlinSupervisor): KotlinShape => {
  const call: KotlinShape["call"] = (method, params) =>
    Effect.tryPromise({ try: () => jvm.call(method, params), catch: asError });
  return { call, readTags: (path) => call("readTags", { path }) };
};

/** Kotlin over JVMs from `options.spawn`, started now and shut down with the layer's scope. */
export const kotlinLayer = (options: KotlinSupervisorOptions) =>
  Layer.effect(
    Kotlin,
    Effect.acquireRelease(
      Effect.sync(() => superviseKotlin(options)),
      (jvm) => Effect.sync(() => jvm.dispose()),
    ).pipe(Effect.map(kotlinOf)),
  );
