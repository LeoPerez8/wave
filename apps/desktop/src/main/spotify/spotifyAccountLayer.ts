import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createSpotifyAccount, type SpotifyAccountService } from "./spotifyAccount.ts";

/** The desktop session and authorized Web API requests for main-process services. */
export class SpotifyAccount extends Context.Service<SpotifyAccount, SpotifyAccountService>()(
  "@wave/desktop/SpotifyAccount",
) {}

export const spotifyAccountLayer = (options: Parameters<typeof createSpotifyAccount>[0]) =>
  Layer.effect(
    SpotifyAccount,
    Effect.gen(function* () {
      const account = createSpotifyAccount(options);
      yield* Effect.addFinalizer(() => Effect.sync(account.dispose));
      return account;
    }),
  );
