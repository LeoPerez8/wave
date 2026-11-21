import { Database } from "@wave/client";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Downloads } from "../downloads/downloadsLayer.ts";
import { Playback } from "../playback/playback.ts";
import { YtMusic } from "../yt/ytMusic.ts";
import { SpotifyAccount } from "./spotifyAccountLayer.ts";
import { createSpotifyImport, type SpotifyImportShape } from "./spotifyImport.ts";

/** Import Playlists › From Spotify, read as the account `SpotifyAccount` holds. */
export class SpotifyImport extends Context.Service<SpotifyImport, SpotifyImportShape>()(
  "@wave/desktop/SpotifyImport",
) {}

export const spotifyImportLayer = (options: { readonly fetch: typeof globalThis.fetch }) =>
  Layer.effect(
    SpotifyImport,
    Effect.gen(function* () {
      const db = yield* Database;
      const account = yield* SpotifyAccount;
      const yt = yield* YtMusic;
      const downloads = yield* Downloads;
      const playback = yield* Playback;
      return createSpotifyImport({
        db,
        account,
        fetch: options.fetch,
        yt,
        downloads,
        changed: playback.refresh,
      });
    }),
  );
