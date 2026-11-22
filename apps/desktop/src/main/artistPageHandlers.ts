/**
 * Main's side of `window.wave.artistPage`: a Library artist's album shelves and YouTube Music
 * section, and an album hero's artists. Each call's arguments are checked before use.
 */
import { Database } from "@wave/client";
import { browseTrackIds } from "./library/browse.ts";
import * as Effect from "effect/Effect";
import type { BridgeContract } from "../shared/bridge.ts";
import type { ARTIST_PAGE_CALLS, ArtistPlayStart } from "../shared/artistPage.ts";
import { albumArtists, artistAlbums } from "./library/artistPage.ts";
import { Playback } from "./playback/playback.ts";
import { YtFeatures } from "./yt/ytServices.ts";

type Call = (typeof ARTIST_PAGE_CALLS)[number];
type Handlers = {
  readonly [C in Call]: (
    args: readonly unknown[],
  ) => Effect.Effect<BridgeContract[C]["result"], unknown, Database | YtFeatures | Playback>;
};

const refuse = (call: Call) => Effect.fail(new Error(`Refused ${call}: invalid arguments`));
const id = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const index = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const pick = (value: unknown): value is "library" | "online" | null =>
  value === null || value === "library" || value === "online";
const start = (value: unknown): value is ArtistPlayStart => {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  const at = (value as Record<string, unknown>)[keys[0]!];
  return (keys[0] === "library" || keys[0] === "streamed" || keys[0] === "popular") && index(at);
};

export const artistPageHandlers = (): Handlers => ({
  "artistPage.albums": ([artistId]) =>
    id(artistId)
      ? Effect.map(Database, (db) => artistAlbums(db, artistId))
      : refuse("artistPage.albums"),
  "artistPage.albumArtists": ([albumId]) =>
    id(albumId)
      ? Effect.map(Database, (db) => ({ artists: albumArtists(db, albumId) }))
      : refuse("artistPage.albumArtists"),
  "artistPage.section": ([artistId, picked, offset, limit]) =>
    id(artistId) && pick(picked) && index(offset) && index(limit) && limit <= 500
      ? Effect.map(YtFeatures, ({ artistSection }) =>
          artistSection.view(artistId, picked, offset, limit),
        )
      : refuse("artistPage.section"),
  "artistPage.songs": ([artistId, picked, limit]) =>
    id(artistId) && pick(picked) && index(limit) && limit <= 500
      ? Effect.map(YtFeatures, ({ artistSection }) =>
          artistSection.pageSongs(artistId, picked, limit),
        )
      : refuse("artistPage.songs"),
  "artistPage.ask": ([artistId]) =>
    id(artistId)
      ? Effect.gen(function* () {
          const { artistSection } = yield* YtFeatures;
          yield* Effect.promise(() => artistSection.ask(artistId));
        })
      : refuse("artistPage.ask"),
  "artistPage.play": ([artistId, picked, from, shuffle, popular]) =>
    id(artistId) &&
    pick(picked) &&
    start(from) &&
    typeof shuffle === "boolean" &&
    typeof popular === "boolean" &&
    // The artist page's Popular list starts from its own places, the Songs view from its own.
    (from === null || popular === "popular" in from)
      ? Effect.gen(function* () {
          const { artistSection } = yield* YtFeatures;
          const playback = yield* Playback;
          if (popular) {
            const ids = artistSection.pageQueue(artistId, picked);
            const at = from !== null && "popular" in from ? from.popular : undefined;
            if (at !== undefined && at >= ids.length)
              return yield* Effect.fail(new Error("Invalid song position"));
            return yield* Effect.tryPromise({
              try: () =>
                playback.activate(ids, at, { kind: "artist", id: String(artistId) }, shuffle),
              catch: (error) => error,
            });
          }
          const db = yield* Database;
          const { ids, listStart } = artistSection.queue(artistId, picked);
          const at =
            from === null
              ? undefined
              : "library" in from
                ? // A Library row keeps its song wherever the Popular list puts it.
                  ids.indexOf(
                    browseTrackIds(db, { kind: "artist", id: artistId })[from.library] ?? "",
                  )
                : "streamed" in from
                  ? listStart + from.streamed
                  : -1;
          if (at !== undefined && (at < 0 || at >= ids.length))
            return yield* Effect.fail(new Error("Invalid song position"));
          return yield* Effect.tryPromise({
            try: () =>
              playback.activate(ids, at, { kind: "artist", id: String(artistId) }, shuffle),
            catch: (error) => error,
          });
        })
      : refuse("artistPage.play"),
  "artistPage.albumSection": ([albumId, picked]) =>
    id(albumId) && pick(picked)
      ? Effect.map(YtFeatures, ({ albumSection }) => albumSection.view(albumId, picked))
      : refuse("artistPage.albumSection"),
  "artistPage.albumAsk": ([albumId, picked, again]) =>
    id(albumId) && pick(picked) && typeof again === "boolean"
      ? Effect.gen(function* () {
          const { albumSection } = yield* YtFeatures;
          yield* Effect.promise(() => albumSection.ask(albumId, picked, again));
        })
      : refuse("artistPage.albumAsk"),
  "artistPage.albumPlay": ([albumId, picked, from, shuffle]) =>
    id(albumId) && pick(picked) && (from === null || index(from)) && typeof shuffle === "boolean"
      ? Effect.gen(function* () {
          const { albumSection } = yield* YtFeatures;
          const playback = yield* Playback;
          const ids = albumSection.queue(albumId, picked);
          if (from !== null && from >= ids.length)
            return yield* Effect.fail(new Error("Invalid song position"));
          return yield* Effect.tryPromise({
            try: () =>
              playback.activate(
                ids,
                from ?? undefined,
                { kind: "album", id: String(albumId) },
                shuffle,
              ),
            catch: (error) => error,
          });
        })
      : refuse("artistPage.albumPlay"),
});
