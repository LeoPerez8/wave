/**
 * The YT Music matches Wave found for Library songs (docs/spec.md, "Sharing
 * playlists" › Matching): the video id a Songs search found for a song that
 * has none, remembered on this phone only (the key-value store,
 * `ytMatch.<track id>`, never synced) so Share and Export don't search for it
 * again. It's kept apart from the video id a song downloaded from YouTube
 * stores, which is the song's own. A song not found isn't remembered.
 */

/** The part of the key-value store the memory reads and writes (expo-sqlite's `Storage`). */
export interface YtMatchStorage {
  multiGet(keys: string[]): Promise<readonly (readonly [string, string | null])[]>;
  setItem(key: string, value: string): Promise<void>;
}

/** Where the match of the Library song [trackId] is kept. */
const keyOf = (trackId: number): string => `ytMatch.${trackId}`;

/** This phone's YT Music matches for Library songs, kept in [storage]. */
export const ytMatchMemory = (storage: YtMatchStorage) => ({
  /** The remembered video id of each of the Library songs [trackIds], by track id (those with one). */
  recall: async (trackIds: readonly number[]): Promise<ReadonlyMap<number, string>> => {
    if (trackIds.length === 0) return new Map();
    const values = await storage.multiGet(trackIds.map(keyOf));
    const matches = new Map<number, string>();
    values.forEach(([, videoId], index) => {
      const trackId = trackIds[index];
      if (trackId !== undefined && videoId !== null) matches.set(trackId, videoId);
    });
    return matches;
  },
  /** Remembers [videoId] as what a search found for the Library song [trackId]. */
  remember: (trackId: number, videoId: string): Promise<void> =>
    storage.setItem(keyOf(trackId), videoId),
});
