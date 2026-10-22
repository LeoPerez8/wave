import {
  ytAlbumOpening,
  type LibraryAlbumTrack,
  type YtArtistSection,
  type YtLibraryAlbumContext,
  type YtSong,
} from "@wave/core";

/** Keep the local rows, then append online additions; downloads replace their streamed row. */
type Entry<S, L> =
  | { readonly source: "library"; readonly track: L; readonly number: number | null }
  | { readonly source: "stream"; readonly song: S; readonly number: number };

export const albumRowsInPlace = <
  S extends { readonly videoId: string },
  L extends { readonly id: number },
>(
  previous: readonly Entry<S, L>[],
  next: readonly Entry<S, L>[],
  find: (song: S) => L | null = () => null,
): readonly Entry<S, L>[] => {
  const key = (entry: Entry<S, L>) =>
    entry.source === "library" ? `local:${entry.track.id}` : `yt:${entry.song.videoId}`;
  const remaining = new Map(next.map((entry) => [key(entry), entry]));
  const result: Entry<S, L>[] = [];
  for (const old of previous) {
    const downloaded = old.source === "stream" ? find(old.song) : null;
    const replacement =
      downloaded === null ? remaining.get(key(old)) : remaining.get(`local:${downloaded.id}`);
    if (replacement === undefined) continue;
    result.push(replacement);
    remaining.delete(key(replacement));
    remaining.delete(key(old));
  }
  result.push(...remaining.values());
  return result.length === previous.length &&
    result.every((entry, index) => {
      const old = previous[index]!;
      return (
        entry.source === old.source &&
        entry.number === old.number &&
        (entry.source === "library"
          ? old.source === "library" && entry.track === old.track
          : old.source === "stream" && entry.song === old.song)
      );
    })
    ? previous
    : result;
};

/** The app's album data boundary: local rows draw while optional work is deferred. */
export const albumOpening = <
  S extends YtSong,
  L extends LibraryAlbumTrack & { readonly id: number },
>(
  state: YtArtistSection<S>,
  context: YtLibraryAlbumContext<S, L> & {
    readonly contentReady: boolean;
    readonly settled: boolean;
    readonly online: boolean;
    readonly retryArtist?: boolean;
  },
  find: ((song: S) => L | null) | null = null,
  held: readonly Entry<S, L>[] | null = null,
) => {
  const work = ytAlbumOpening(state, { ...context, elsewhere: find ?? (() => null) });
  const previous =
    held ??
    context.tracks.map((track) => ({
      source: "library" as const,
      track,
      number: track.trackNumber,
    }));
  const joined = work.view?.tracks;
  const entries = joined == null || find === null ? null : albumRowsInPlace(previous, joined, find);
  return { ...work, view: work.view === null ? null : { ...work.view, tracks: entries } };
};
