/** Resolve owner actions into Magic Queue signals without network or snapshot derivation. */
import {
  libraryTrackIds,
  magicLibrarySongs,
  magicYtSong,
  parseTrackId,
  type MagicLibrarySong,
  type MagicSignal,
  type MagicSignalKind,
  type MagicSong,
  type YtSong,
} from "@wave/core";
import * as Effect from "effect/Effect";

export const magicSignalSongs = <E, R>(
  kind: MagicSignalKind,
  trackIds: readonly string[],
  deps: {
    readonly songs: (ids: readonly number[]) => Effect.Effect<
      readonly (MagicLibrarySong & {
        readonly title: string;
        readonly durationMs: number;
      })[],
      E,
      R
    >;
    readonly artists: (
      ids: readonly number[],
    ) => Effect.Effect<readonly { readonly id: number; readonly name: string }[], E, R>;
    readonly videos: (ids: readonly number[]) => Effect.Effect<ReadonlyMap<number, string>, E, R>;
    readonly streamed: (trackId: string) => YtSong | null;
    readonly weighStreamed?: (trackId: string, artists: readonly string[]) => MagicSong;
  },
): Effect.Effect<MagicSignal[], E, R> =>
  Effect.gen(function* () {
    const ids = libraryTrackIds(trackIds);
    const songs = ids.length === 0 ? [] : yield* deps.songs(ids);
    const artists =
      songs.length === 0
        ? []
        : yield* deps.artists([...new Set(songs.flatMap((song) => song.artistIds))]);
    const mapper = magicLibrarySongs(artists);
    const names = new Map(artists.map((artist) => [artist.id, artist.name]));
    const learnsRadio = kind === "favorite" || kind === "download" || kind === "added";
    const videos =
      !learnsRadio || songs.length === 0 ? new Map<number, string>() : yield* deps.videos(ids);
    return [
      ...songs.map((song): MagicSignal => ({
        kind,
        song: mapper(song),
        ...(learnsRadio
          ? {
              radio: {
                id: `song:${song.id}`,
                title: song.title,
                artists: song.artistIds.flatMap((id) => names.get(id) ?? []),
                durationMs: song.durationMs,
                ...(videos.get(song.id) === undefined ? {} : { videoId: videos.get(song.id)! }),
              },
            }
          : {}),
      })),
      ...trackIds.flatMap((trackId): MagicSignal[] => {
        const ref = parseTrackId(trackId);
        if (ref?.kind !== "yt") return [];
        const known = deps.streamed(trackId);
        if (known === null && !learnsRadio) return [];
        const credits = known?.artists ?? [];
        return [
          {
            kind,
            song:
              deps.weighStreamed?.(trackId, credits) ??
              magicYtSong({ trackId, artists: credits }, () => null),
            ...(learnsRadio
              ? {
                  radio: {
                    id: `song:${trackId}`,
                    title: known?.title ?? ref.videoId,
                    artists: credits,
                    durationMs: known?.durationMs ?? null,
                    videoId: ref.videoId,
                  },
                }
              : {}),
          },
        ];
      }),
    ];
  });
