/**
 * Now Playing's Related view: what YouTube Music's watch-next Related tab
 * gives for the playing song, read once per song per session.
 */

/** What Related shows for a song: loading, its answer, or "Couldn't load the related songs". */
export type RelatedSongsShown<A> =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly answer: A }
  | { readonly status: "failed" };

/** The session's related songs, by the video id of the song they're related to. */
export interface RelatedSongsSession<A> {
  /**
   * What Related shows for the song [videoId]: a song with none (a Library
   * song never matched on YouTube Music, null) shows the error, and one
   * whose id isn't known yet (undefined: an unsearched entry being searched)
   * shows loading, as does a song not read yet. The same object until it
   * changes, so a store can hand it out as its snapshot.
   */
  readonly shown: (videoId: string | null | undefined) => RelatedSongsShown<A>;
  /**
   * Reads the related songs of [videoId], unless the session holds them or
   * a read is on its way: Related opening on a song, and Try Again after a
   * failure (a failure isn't kept, so it reads again).
   */
  readonly read: (videoId: string) => void;
  /** Calls [listener] whenever what a song shows changes; returns the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void;
}

const LOADING = { status: "loading" } as const;
const FAILED = { status: "failed" } as const;

/** A session's related songs, each read by [read] (which rejects offline or on a failure). */
export const createRelatedSongsSession = <A>(
  read: (videoId: string) => Promise<A>,
): RelatedSongsSession<A> => {
  const songs = new Map<string, RelatedSongsShown<A>>();
  const listeners = new Set<() => void>();
  const set = (videoId: string, shown: RelatedSongsShown<A>): void => {
    songs.set(videoId, shown);
    for (const listener of listeners) listener();
  };
  return {
    shown: (videoId) => {
      if (videoId === null) return FAILED;
      if (videoId === undefined) return LOADING;
      return songs.get(videoId) ?? LOADING;
    },
    read: (videoId) => {
      const held = songs.get(videoId);
      if (held !== undefined && held.status !== "failed") return;
      set(videoId, LOADING);
      read(videoId).then(
        (answer) => set(videoId, { status: "loaded", answer }),
        () => set(videoId, FAILED),
      );
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
