/**
 * Main's side of the bridge for YouTube Music's pages, Discover and the Magic Queue
 * (`YtFeatures`): each call's arguments are checked before use, and songs go back as rows.
 */
import type { YtAlbumSong } from "@wave/core";
import * as Effect from "effect/Effect";

import type { BridgeCall, BridgeContract, Page } from "../../shared/bridge.ts";
import type { BrowseRow } from "../../shared/browse.ts";
import type { SongTarget } from "../../shared/songActions.ts";
import { ytRow } from "../../shared/yt.ts";
import { browseSongs } from "../library/browse.ts";
import { Database } from "@wave/client";
import { VIDEO_ID, YtMusic } from "./ytMusic.ts";
import { YtFeatures } from "./ytServices.ts";

type YtFeatureCall =
  | "yt.artist"
  | "yt.findArtist"
  | "yt.album"
  | "yt.related"
  | "discover.picks"
  | "discover.mixes"
  | "discover.playMix"
  | "magicQueue.start"
  | "magicQueue.startStreamed"
  | "magicQueue.view"
  | "magicQueue.retry";

export type YtFeatureHandlers = {
  readonly [C in YtFeatureCall]: (
    args: readonly unknown[],
  ) => Effect.Effect<BridgeContract[C]["result"], unknown, YtFeatures | YtMusic | Database>;
};

const refuse = (call: BridgeCall, why: string) => Effect.fail(new Error(`Refused ${call}: ${why}`));

const featuresCall = <A>(run: (features: YtFeatures["Service"]) => A | Promise<A>) =>
  Effect.gen(function* () {
    const features = yield* YtFeatures;
    return yield* Effect.tryPromise({ try: async () => run(features), catch: (error) => error });
  });

/** A YouTube Music browse id, as artist and album pages are named. */
const browseId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{2,128}$/.test(value);

const rows = (songs: readonly YtAlbumSong[]): Page<BrowseRow> => {
  const items = songs.map(ytRow);
  return { items, offset: 0, total: items.length };
};

export const createYtFeatureHandlers = (
  validTarget: (value: unknown) => value is SongTarget,
): YtFeatureHandlers => ({
  "yt.artist": ([id]) =>
    browseId(id)
      ? featuresCall(async ({ pages }) => {
          const { status, page } = await pages.artist(id);
          return {
            status,
            page:
              page === null
                ? null
                : {
                    name: page.name,
                    artworkUrl: page.artworkUrl ?? null,
                    songs: rows(page.songs),
                    albums: page.albums,
                    singles: page.singles,
                    similar: page.similar ?? [],
                  },
          };
        })
      : refuse("yt.artist", "invalid artist"),
  "yt.findArtist": ([name]) =>
    typeof name === "string" && name.length > 0 && name.length <= 500
      ? featuresCall(({ pages }) => pages.findArtist(name))
      : refuse("yt.findArtist", "invalid name"),
  "yt.album": ([id]) =>
    browseId(id)
      ? featuresCall(async ({ pages }) => {
          const { status, album } = await pages.album(id);
          return {
            status,
            album: album === null ? null : { ...album, songs: rows(album.songs) },
          };
        })
      : refuse("yt.album", "invalid album"),
  "yt.related": () =>
    featuresCall(async ({ related }) => {
      const { status, songs, artists } = await related();
      return { status, songs: rows(songs), artists };
    }),
  "discover.picks": () =>
    Effect.gen(function* () {
      const features = yield* YtFeatures;
      const items = browseSongs(yield* Database, features.discover.picks());
      return { items, offset: 0, total: items.length };
    }),
  "discover.mixes": () =>
    featuresCall(async ({ discover }) => {
      const { status, mixes } = await discover.mixes();
      return {
        status,
        mixes: mixes.map((mix) => ({ id: mix.id, name: mix.name, songs: rows(mix.songs) })),
      };
    }),
  "discover.playMix": ([id, index]) =>
    typeof id === "string" &&
    id.length <= 200 &&
    typeof index === "number" &&
    Number.isSafeInteger(index) &&
    index >= 0
      ? featuresCall(({ playMix }) => playMix(id, index))
      : refuse("discover.playMix", "invalid mix or song"),
  "magicQueue.start": ([target]) =>
    validTarget(target)
      ? featuresCall(({ startMagicQueue }) => startMagicQueue(target))
      : refuse("magicQueue.start", "invalid songs"),
  "magicQueue.startStreamed": ([videoId]) =>
    typeof videoId === "string" && VIDEO_ID.test(videoId)
      ? Effect.gen(function* () {
          const song = (yield* YtMusic).song(videoId);
          if (song === undefined)
            return yield* Effect.fail(new Error("[yt-unknown] That song isn't known anymore"));
          return yield* featuresCall(({ magicQueue }) => magicQueue.startStreamed(song));
        })
      : refuse("magicQueue.startStreamed", "invalid song"),
  "magicQueue.view": () => featuresCall(({ magicQueue }) => magicQueue.view()),
  "magicQueue.retry": () => featuresCall(({ magicQueue }) => magicQueue.retry()),
});
