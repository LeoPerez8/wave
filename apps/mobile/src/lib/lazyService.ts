import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * A layer for a service the first screen doesn't need (docs/spec.md,
 * Performance rules, "Load on first use"): the app's runtime starts without
 * building it, and the first read of one of its members builds it, once, from
 * [load]. Callers see the same interface. [load] is a thunk so that, with
 * Metro's inline requires, the module holding the implementation loads then
 * too. Building must be synchronous (it may read other services).
 */
export const lazyService = <Self, Shape extends object, R>(
  tag: Context.Key<Self, Shape>,
  load: () => Effect.Effect<Shape, never, R>,
): Layer.Layer<Self, never, R> =>
  Layer.effect(
    tag,
    Effect.map(Effect.context<R>(), (context) => {
      let built: Shape | null = null;
      const service = (): Shape => (built ??= Effect.runSyncWith(context)(load()));
      return new Proxy({} as Shape, {
        get: (_, key) => Reflect.get(service(), key),
        has: (_, key) => Reflect.has(service(), key),
      });
    }),
  );
