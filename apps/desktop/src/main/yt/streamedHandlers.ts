/** Main's side of `window.wave.streamed`: a streamed song's menu, checked before use. */
import { Database } from "@wave/client";
import { ytTrackId, type UpNextPlace, type YtAlbumSong } from "@wave/core";
import * as Effect from "effect/Effect";
import type { BridgeContract } from "../../shared/bridge.ts";
import {
  STREAMED_RUN_ACTIONS,
  type STREAMED_CALLS,
  type StreamedRunAction,
} from "../../shared/streamedSongs.ts";
import { Downloads } from "../downloads/downloadsLayer.ts";
import { Playback } from "../playback/playback.ts";
import { validQueuePlace } from "../playback/validation.ts";
import {
  runStreamedAction,
  streamedArtistTarget,
  streamedSongMenu,
  type StreamedSongPorts,
} from "./streamedSong.ts";
import { VIDEO_ID, YtMusic } from "./ytMusic.ts";

type Call = (typeof STREAMED_CALLS)[number];
type Services = Database | Downloads | Playback | YtMusic;
type Handlers = {
  readonly [C in Call]: (
    args: readonly unknown[],
  ) => Effect.Effect<BridgeContract[C]["result"], unknown, Services>;
};

const refuse = (call: Call, why: string) => Effect.fail(new Error(`Refused ${call}: ${why}`));

const playlistId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** The handlers; the downloads only a star asked for are the downloads service's to keep. */
export const streamedHandlers = () => {
  /** [videoId]'s song, which a page or the queue brought, and the ports its menu runs on. */
  const withSong = <A>(
    videoId: unknown,
    act: (ports: StreamedSongPorts, song: YtAlbumSong) => A | Promise<A>,
    at?: UpNextPlace,
  ) =>
    Effect.gen(function* () {
      const yt = yield* YtMusic;
      const song = typeof videoId === "string" ? yt.song(videoId) : undefined;
      if (song === undefined)
        return yield* Effect.fail(new Error("[yt-unknown] That song isn't known anymore"));
      const playback = yield* Playback;
      const ports: StreamedSongPorts = {
        db: yield* Database,
        ytMusic: yt.enabled,
        downloads: yield* Downloads,
        queue: (type, id) =>
          playback.dispatch(
            type === "addToQueue" && at !== undefined
              ? { type, trackIds: [ytTrackId(id)], at }
              : { type, trackIds: [ytTrackId(id)] },
          ),
        changed: playback.refresh,
      };
      return yield* Effect.tryPromise({
        try: async () => act(ports, song),
        catch: (error) => error,
      });
    });

  const handlers: Handlers = {
    "streamed.menu": ([videoId, playing]) =>
      typeof videoId === "string" && VIDEO_ID.test(videoId) && typeof playing === "boolean"
        ? withSong(videoId, (ports, song) => streamedSongMenu(ports, song, playing))
        : refuse("streamed.menu", "invalid song"),
    "streamed.artist": ([name]) =>
      typeof name === "string" && name.trim() !== ""
        ? Effect.map(Database, (db) => streamedArtistTarget(db, name))
        : refuse("streamed.artist", "invalid name"),
    "streamed.run": ([videoId, action, playlist, at]) =>
      typeof videoId === "string" &&
      VIDEO_ID.test(videoId) &&
      STREAMED_RUN_ACTIONS.includes(action as StreamedRunAction) &&
      (action === "addToPlaylist" ? playlistId(playlist) : playlist === undefined) &&
      validQueuePlace(action, at)
        ? withSong(
            videoId,
            (ports, song) =>
              runStreamedAction(ports, song, action as StreamedRunAction, playlist as number),
            at as UpNextPlace | undefined,
          )
        : refuse("streamed.run", "invalid song, action or playlist"),
  };

  /** The player's star: a streamed song playing is starred as its menu stars it. */
  const favoritePlaying = Effect.gen(function* () {
    const playback = yield* Playback;
    const current = playback.view().current;
    if (current?.videoId === undefined) return playback.favorite();
    yield* withSong(current.videoId, (ports, song) =>
      runStreamedAction(ports, song, current.favorite ? "unfavorite" : "favorite"),
    );
  });
  return { handlers, favoritePlaying };
};
