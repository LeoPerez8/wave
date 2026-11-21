/** Main's side of `window.wave.follows`: an artist page's Follow button and Settings › Followed artists. */
import * as Effect from "effect/Effect";

import type { BridgeContract } from "../../shared/bridge.ts";
import {
  validFollowLevel,
  validFollowName,
  validFollowTarget,
  type FOLLOWS_CALLS,
} from "../../shared/follows.ts";
import { Account } from "../account/accountLayer.ts";
import { FollowedArtists, type FollowedArtistsShape } from "./followedArtists.ts";

type FollowsCall = (typeof FOLLOWS_CALLS)[number];

export type FollowsHandlers = {
  readonly [C in FollowsCall]: (
    args: readonly unknown[],
  ) => Effect.Effect<BridgeContract[C]["result"], unknown, Account | FollowedArtists>;
};

const refuse = (call: FollowsCall, why: string) =>
  Effect.fail(new Error(`Refused ${call}: ${why}`));
const read = <A>(ask: (follows: FollowedArtistsShape) => A) =>
  Effect.gen(function* () {
    const follows = yield* FollowedArtists;
    return yield* Effect.try({ try: () => ask(follows), catch: (error) => error });
  });
/** A change the account holds: it goes up without waiting for the timed sync. */
const change = <A>(ask: (follows: FollowedArtistsShape) => A) =>
  Effect.gen(function* () {
    const result = yield* read(ask);
    (yield* Account).settingsEdited();
    return result;
  });

export const followsHandlers: FollowsHandlers = {
  "follows.state": ([name]) =>
    validFollowName(name)
      ? read((follows) => follows.state(name))
      : refuse("follows.state", "invalid artist"),
  "follows.set": ([target, level]) =>
    validFollowTarget(target) && validFollowLevel(level)
      ? change((follows) => follows.set(target, level))
      : refuse("follows.set", "invalid follow"),
  "follows.restore": ([key]) =>
    validFollowName(key)
      ? change((follows) => follows.restore(key))
      : refuse("follows.restore", "invalid artist"),
  "follows.view": () => read((follows) => follows.view()),
  "follows.setEnabled": ([on]) =>
    typeof on === "boolean"
      ? change((follows) => follows.setEnabled(on))
      : refuse("follows.setEnabled", "not a switch"),
  // This computer's own choice: nothing to sync.
  "follows.setCountry": ([country]) =>
    country === null || typeof country === "string"
      ? read((follows) => follows.setCountry(country))
      : refuse("follows.setCountry", "invalid country"),
  "follows.search": ([query]) =>
    validFollowName(query)
      ? Effect.gen(function* () {
          const follows = yield* FollowedArtists;
          return yield* Effect.tryPromise({
            try: () => follows.search(query),
            catch: (error) => error,
          });
        })
      : refuse("follows.search", "invalid query"),
};
