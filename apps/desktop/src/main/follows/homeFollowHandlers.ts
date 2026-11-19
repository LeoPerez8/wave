import * as Effect from "effect/Effect";
import { HomeFollow, type HomeFollowShape } from "./homeFollow.ts";

const call = <A>(ask: (follow: HomeFollowShape) => Promise<A>) =>
  Effect.gen(function* () {
    const follow = yield* HomeFollow;
    return yield* Effect.tryPromise({ try: () => ask(follow), catch: (error) => error });
  });
/** A release card's key, as Deezer's ids make it. */
const releaseKey = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

/** The window names a card by its key; main finds the release, its cover and where it opens. */
export const homeFollowHandlers = {
  "home.follow": () => call((follow) => follow.view()),
  "home.followCheck": () => call((follow) => follow.check()),
  "home.openRelease": ([key]: readonly unknown[]) =>
    releaseKey(key)
      ? call((follow) => follow.open(key))
      : Effect.fail(new Error("Refused home.openRelease: invalid release")),
  "home.releaseArtwork": ([key]: readonly unknown[]) =>
    releaseKey(key)
      ? call((follow) => follow.artwork(key))
      : Effect.fail(new Error("Refused home.releaseArtwork: invalid release")),
};
