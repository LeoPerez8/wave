import { Database } from "@wave/client";
import { trackQuery } from "@wave/client/db/tracks";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { WaveAccountService } from "../account/account.ts";
import { Kotlin } from "../kotlin/kotlin.ts";
import { geniusInsightsEnabled } from "../library/lyricsAndTags.ts";
import { Playback } from "../playback/playback.ts";
import { YtMusic, ytSongs } from "../yt/ytMusic.ts";
import { YtFeatures } from "../yt/ytServices.ts";
import { createGeniusLyricsSearch, type DesktopGeniusLyricsSearch } from "./geniusLyricsSearch.ts";

export class GeniusLyricsSearch extends Context.Service<
  GeniusLyricsSearch,
  DesktopGeniusLyricsSearch
>()("@wave/desktop/GeniusLyricsSearch") {}

/** Search's online lyrics over the Wave account, the Library, YT Music and playback. */
export const geniusLyricsSearchLayer = (options: {
  readonly account: WaveAccountService;
  readonly online: () => boolean;
  readonly openExternal: (url: string) => Promise<void>;
}) =>
  Layer.effect(
    GeniusLyricsSearch,
    Effect.gen(function* () {
      const db = yield* Database;
      const kotlin = yield* Kotlin;
      const playback = yield* Playback;
      const yt = yield* YtMusic;
      const features = yield* YtFeatures;
      const { account } = options;
      const search = createGeniusLyricsSearch({
        enabled: () => geniusInsightsEnabled(db),
        account: () =>
          account.view().account.kind === "unavailable"
            ? "unavailable"
            : account.session().status === "signedIn"
              ? "signedIn"
              : "signedOut",
        online: options.online,
        request: account.request,
        library: () => trackQuery(db, "files").all(),
        ytMusic: yt.enabled,
        searchSongs: async (query) => {
          const page = (await Effect.runPromise(kotlin.call("search", { query }))) as {
            songs?: unknown;
          };
          return ytSongs(page.songs);
        },
        // As a link's song starts: YT Music's song with its queue, the Library's as Search plays it.
        start: async (song) => {
          if ("videoId" in song) {
            yt.keep([song]);
            await features.magicQueue.startStreamed(song);
            return;
          }
          const started = await playback.activate([String(song.id)], 0, {
            kind: "search",
            id: null,
          });
          if (started.kind === "nothing") throw new Error("The song cannot play here");
        },
        openUrl: options.openExternal,
      });
      // The answer belongs to the session that asked.
      const stop = account.subscribe(() => search.cancel());
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          stop();
          search.cancel();
        }),
      );
      return search;
    }),
  );
