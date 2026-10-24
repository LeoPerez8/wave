/** A live first page per session, cached starts, and continuation reads only when low. */
import { recordingMatches, type MagicSongRadioSeed, type YtAlbumSong } from "@wave/core";
import * as Effect from "effect/Effect";

export type SongRadioSeed = MagicSongRadioSeed;
export interface SongRadioPage {
  readonly songs: readonly (YtAlbumSong & { readonly video?: boolean })[];
  readonly continuation: string | null;
}
const MAGIC_RADIO_DEADLINE_MS = 8000;

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
  let page = deps.cached;
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
      const songs = yield* deps.search(`${seed.title} ${seed.artists.join(" ")}`);
      videoId = songs.find((song) =>
        recordingMatches(
          { title: seed.title, artist: seed.artists.join(", "), durationMs: seed.durationMs ?? 0 },
          song,
        ),
      )?.videoId;
    }
    if (videoId !== undefined) return yield* deps.radio(videoId);
    const artist = seed.artists[0];
    if (artist === undefined) return null;
    deps.fallback(artist);
    return yield* deps.artist(artist);
  });
  const load = (read: Effect.Effect<SongRadioPage | null, E, R>) =>
    (deps.measure ?? ((effect) => effect))(
      read.pipe(Effect.timeout(deps.deadlineMs ?? MAGIC_RADIO_DEADLINE_MS)),
    ).pipe(
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
    read: ({ online, low }: { readonly online: boolean; readonly low: boolean }) =>
      Effect.gen(function* () {
        if (!online || reading) return page;
        if (!started) {
          started = true;
          reading = true;
          const refresh = load(first);
          if (page === null) return yield* refresh;
          yield* Effect.forkDetach(refresh);
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
        );
      }),
  };
};
