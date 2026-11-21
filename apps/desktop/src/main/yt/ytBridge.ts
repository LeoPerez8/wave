/**
 * Main's side of the bridge for YouTube Music's pages, Discover and the Magic Queue
 * (`YtFeatures`): each call's arguments are checked before use, and songs go back as rows.
 */
import {
  discoverMixCaption,
  isSliderStep,
  ytTrackId,
  type YtAlbumSong,
  type YtArtistAlbum,
} from "@wave/core";
import * as Effect from "effect/Effect";

import type { BridgeCall, BridgeContract, Page } from "../../shared/bridge.ts";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import type { SongTarget } from "../../shared/songActions.ts";
import type { DiscoverSettings } from "../../shared/ytPages.ts";
import { ytRow } from "../../shared/yt.ts";
import { browseSongs } from "../library/browse.ts";
import { Database } from "@wave/client";
import { selectPlaylistEntrySongs } from "@wave/client/db/playlists";
import { Playback } from "../playback/playback.ts";
import { VIDEO_ID, YtMusic } from "./ytMusic.ts";
import { YtFeatures } from "./ytServices.ts";

type YtFeatureCall =
  | "yt.search"
  | "yt.artist"
  | "yt.findArtist"
  | "yt.album"
  | "yt.related"
  | "yt.queue"
  | "discover.picks"
  | "discover.mixes"
  | "discover.settings"
  | "discover.setSettings"
  | "discover.playMix"
  | "magicQueue.start"
  | "magicQueue.startStreamed"
  | "magicQueue.view"
  | "magicQueue.retry"
  | "playlistSuggestions.view"
  | "playlistSuggestions.add"
  | "playlistSuggestions.dismiss"
  | "playlistSuggestions.refresh"
  | "playlistSuggestions.retry"
  | "playlistSuggestions.close";

export type YtFeatureHandlers = {
  readonly [C in YtFeatureCall]: (
    args: readonly unknown[],
  ) => Effect.Effect<
    BridgeContract[C]["result"],
    unknown,
    YtFeatures | YtMusic | Database | Playback
  >;
};

const refuse = (call: BridgeCall, why: string) => Effect.fail(new Error(`Refused ${call}: ${why}`));

const playlistIdOf = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
/** A suggestion's key, as the visit makes them. */
const offerKeyOf = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 100;

/** A Library song clicked in Search (docs/spec.md, story 47). */
export const playSearchSong = (scope: BrowseScope, index: number) =>
  featuresCall(({ playSearchSong }) => playSearchSong(scope, index));

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

const discoverSettings = (value: unknown): value is DiscoverSettings => {
  if (typeof value !== "object" || value === null) return false;
  const { level, faithfulness, popularity } = value as Record<string, unknown>;
  return isSliderStep(level) && isSliderStep(faithfulness) && isSliderStep(popularity);
};

export const createYtFeatureHandlers = (
  validTarget: (value: unknown) => value is SongTarget,
): YtFeatureHandlers => ({
  "yt.search": ([query]) =>
    typeof query === "string" && query.length <= 500
      ? featuresCall(({ search }) => search(query))
      : refuse("yt.search", "invalid query"),
  "yt.artist": ([id]) =>
    browseId(id)
      ? featuresCall(async ({ pages, libraryReleases }) => {
          const { status, page } = await pages.artist(id);
          const inLibrary =
            page === null
              ? new Map<string, number>()
              : libraryReleases(page.name, [...page.albums, ...page.singles]);
          const released = (releases: readonly YtArtistAlbum[]) =>
            releases.map((release) => ({
              ...release,
              libraryId: inLibrary.get(release.browseId) ?? null,
            }));
          return {
            status,
            page:
              page === null
                ? null
                : {
                    name: page.name,
                    artworkUrl: page.artworkUrl ?? null,
                    songs: rows(page.songs),
                    albums: released(page.albums),
                    singles: released(page.singles),
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
  "yt.queue": ([type, videoId]) =>
    (type === "playNow" || type === "addToQueue") &&
    typeof videoId === "string" &&
    VIDEO_ID.test(videoId)
      ? Effect.gen(function* () {
          // Only a song a page brought can stream.
          if ((yield* YtMusic).song(videoId) === undefined)
            return yield* Effect.fail(new Error("[yt-unknown] That song isn't known anymore"));
          const playback = yield* Playback;
          return yield* Effect.tryPromise({
            try: () => playback.dispatch({ type, trackIds: [ytTrackId(videoId)] }),
            catch: (error) => error,
          });
        })
      : refuse("yt.queue", "invalid song"),
  "discover.picks": () =>
    Effect.gen(function* () {
      const features = yield* YtFeatures;
      const db = yield* Database;
      const picked = features.discover.picks();
      const entries = selectPlaylistEntrySongs(
        db,
        picked.filter((id): id is string => typeof id === "string"),
      );
      // An entry's tile can start its Magic Queue and open its menu once Wave holds the song.
      (yield* YtMusic).keep(entries);
      const items = picked.flatMap((id) =>
        typeof id === "number"
          ? browseSongs(db, [id])
          : entries.flatMap((song) => (song.videoId === id ? [ytRow(song)] : [])),
      );
      return { items, offset: 0, total: items.length };
    }),
  "discover.mixes": () =>
    Effect.gen(function* () {
      const { discover } = yield* YtFeatures;
      const db = yield* Database;
      const { status, mixes } = yield* Effect.promise(() => discover.mixes());
      return {
        status,
        mixes: mixes.map((mix) => {
          // Its Library songs among its new ones, as they play (`discover.playMix`).
          const items = (discover.placed(mix.id) ?? []).flatMap((song) =>
            song.source === "stream" ? [ytRow(song.song)] : browseSongs(db, [song.track]),
          );
          // Its tile's lead artists and cover, as the phone's (Core's `discoverMixCaption`).
          const { artists, artworkUrl } = discoverMixCaption(mix);
          return {
            id: mix.id,
            name: mix.name,
            row: mix.row,
            artists,
            artworkUrl: artworkUrl?.startsWith("https:") === true ? artworkUrl : null,
            songs: { items, offset: 0, total: items.length },
          };
        }),
      };
    }),
  "discover.settings": () => featuresCall(({ discover }) => discover.settings()),
  "discover.setSettings": ([value]) =>
    discoverSettings(value)
      ? featuresCall(({ discover }) => {
          discover.setSettings({
            level: value.level,
            faithfulness: value.faithfulness,
            popularity: value.popularity,
          });
          return discover.settings();
        })
      : refuse("discover.setSettings", "invalid settings"),
  "discover.playMix": ([id, index, shuffle]) =>
    typeof id === "string" &&
    id.length <= 200 &&
    typeof index === "number" &&
    Number.isSafeInteger(index) &&
    index >= 0 &&
    (shuffle === undefined || typeof shuffle === "boolean")
      ? featuresCall(({ playMix }) => playMix(id, index, shuffle))
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
  "playlistSuggestions.view": ([playlistId, sources]) =>
    playlistIdOf(playlistId) && typeof sources === "string" && sources.length <= 200
      ? featuresCall(({ playlistSuggestions }) => playlistSuggestions.view(playlistId, sources))
      : refuse("playlistSuggestions.view", "invalid playlist"),
  "playlistSuggestions.add": ([playlistId, key]) =>
    playlistIdOf(playlistId) && offerKeyOf(key)
      ? featuresCall(({ playlistSuggestions }) => playlistSuggestions.add(playlistId, key))
      : refuse("playlistSuggestions.add", "invalid offer"),
  "playlistSuggestions.dismiss": ([playlistId, key]) =>
    playlistIdOf(playlistId) && offerKeyOf(key)
      ? featuresCall(({ playlistSuggestions }) => playlistSuggestions.dismiss(playlistId, key))
      : refuse("playlistSuggestions.dismiss", "invalid offer"),
  "playlistSuggestions.refresh": ([playlistId]) =>
    playlistIdOf(playlistId)
      ? featuresCall(({ playlistSuggestions }) => playlistSuggestions.refresh(playlistId))
      : refuse("playlistSuggestions.refresh", "invalid playlist"),
  "playlistSuggestions.retry": ([playlistId, refill]) =>
    playlistIdOf(playlistId) && typeof refill === "boolean"
      ? featuresCall(({ playlistSuggestions }) => playlistSuggestions.retry(playlistId, refill))
      : refuse("playlistSuggestions.retry", "invalid playlist"),
  "playlistSuggestions.close": ([playlistId]) =>
    playlistIdOf(playlistId)
      ? featuresCall(({ playlistSuggestions }) => playlistSuggestions.close(playlistId))
      : refuse("playlistSuggestions.close", "invalid playlist"),
});
