/** A live first page per session, cached starts, and continuation reads only when low. */
import {
  musicVideoAudioTrack,
  songSearchMatch,
  songSearchQuery,
  type MagicSongRadioSeed,
  type YtAlbumSong,
} from "@wave/core";
import * as Effect from "effect/Effect";

export type SongRadioSeed = MagicSongRadioSeed;
export interface SongRadioPage {
  readonly songs: readonly (YtAlbumSong & { readonly video?: boolean })[];
  readonly continuation: string | null;
}
/** How long a radio read waited for may take. */
export const MAGIC_RADIO_DEADLINE_MS = 8000;

/**
 * Whether [page] brings a song. A music video's radio brings only music
 * videos, and no batch takes those, so it counts as no radio at all.
 */
const bringsSongs = (page: SongRadioPage | null): page is SongRadioPage =>
  page !== null && page.songs.some((song) => song.video !== true);

/** Network/database dependencies stay at this boundary; no graph or genre reads belong here. */
export const createSongRadioSession = <E, R>(
  seed: SongRadioSeed,
  deps: {
    readonly cached: SongRadioPage | null;
    readonly radio: (videoId: string) => Effect.Effect<SongRadioPage, E, R>;
    readonly search: (query: string) => Effect.Effect<readonly YtAlbumSong[], E, R>;
    readonly artist: (name: string) => Effect.Effect<SongRadioPage | null, E, R>;
    readonly more: (token: string) => Effect.Effect<SongRadioPage, E, R>;
    readonly save: (page: SongRadioPage) => Effect.Effect<void, never, R>;
    readonly fallback: (name: string) => void;
    readonly deadlineMs?: number;
    readonly measure?: (
      read: Effect.Effect<SongRadioPage | null, unknown, R>,
    ) => Effect.Effect<SongRadioPage | null, unknown, R>;
  },
) => {
  // A saved page of videos alone can't start a batch: the first read waits for the live radio.
  let page = bringsSongs(deps.cached) ? deps.cached : null;
  let started = false;
  let reading = false;
  const remember = (received: SongRadioPage) =>
    Effect.gen(function* () {
      const seen = new Set<string>();
      page = {
        ...received,
        // Saved pages can already include continuations. A live first page refines
        // its front while retaining those songs; overlapping pages keep one video.
        songs: [...received.songs, ...(page?.songs ?? [])].filter((song) => {
          if (seen.has(song.videoId)) return false;
          seen.add(song.videoId);
          return true;
        }),
      };
      yield* Effect.forkDetach(deps.save(page));
      return page;
    });
  const first = Effect.gen(function* () {
    if (seed.kind === "artist") return yield* deps.artist(seed.artists[0] ?? seed.title);
    let videoId = seed.videoId;
    if (videoId === undefined) {
      const songs = yield* deps.search(songSearchQuery(seed));
      videoId = songSearchMatch(seed, songs) ?? undefined;
    } else {
      const own = yield* deps.radio(videoId);
      if (bringsSongs(own)) return own;
      // The seed is a music video: the radio of its audio track brings songs.
      const songs = yield* deps.search(songSearchQuery(seed));
      const audioTrack = musicVideoAudioTrack(seed, songs)?.videoId;
      videoId = audioTrack === videoId ? undefined : audioTrack;
    }
    if (videoId !== undefined) return yield* deps.radio(videoId);
    const artist = seed.artists[0];
    if (artist === undefined) return null;
    deps.fallback(artist);
    return yield* deps.artist(artist);
  });
  const load = (
    read: Effect.Effect<SongRadioPage | null, E, R>,
    deadlineMs = deps.deadlineMs ?? MAGIC_RADIO_DEADLINE_MS,
  ) =>
    (deps.measure ?? ((effect) => effect))(read.pipe(Effect.timeout(deadlineMs))).pipe(
      Effect.flatMap((received) => {
        if (received === null) {
          if (page === null) started = false;
          return Effect.succeed(page);
        }
        return remember(received);
      }),
      Effect.orElseSucceed(() => {
        if (page === null) started = false;
        return page;
      }),
      Effect.ensuring(
        Effect.sync(() => {
          reading = false;
        }),
      ),
    );
  return {
    current: () => page,
    /**
     * A read waited for stops at [deadlineAt] (epoch ms) when given, so it
     * shares a deadline that started before it; a refresh in the background
     * keeps its own.
     */
    read: ({
      online,
      low,
      deadlineAt,
    }: {
      readonly online: boolean;
      readonly low: boolean;
      readonly deadlineAt?: number;
    }) =>
      Effect.gen(function* () {
        if (!online || reading) return page;
        const left =
          deadlineAt === undefined
            ? undefined
            : Math.max(
                0,
                Math.min(deps.deadlineMs ?? MAGIC_RADIO_DEADLINE_MS, deadlineAt - Date.now()),
              );
        if (!started) {
          started = true;
          reading = true;
          if (page === null) return yield* load(first, left);
          yield* Effect.forkDetach(load(first));
          return page;
        }
        if (!low || page?.continuation == null) return page;
        reading = true;
        const before = page;
        return yield* load(
          Effect.map(deps.more(before.continuation!), (next) => ({
            songs: [...before.songs, ...next.songs],
            continuation: next.continuation,
          })),
          left,
        );
      }),
  };
};
