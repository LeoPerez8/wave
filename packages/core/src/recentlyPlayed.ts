/**
 * Home's Recently played shelf: the albums of the songs played, the one
 * played last first. The store reads played songs by their latest play, a
 * page at a time, so the shelf costs a few songs however long the history.
 */

/** A played song, as the store reads it for the shelf. */
export interface LatestPlayedSong {
  readonly albumId: number;
  /** When its latest play (counted or not) started. */
  readonly lastPlayedAt: number;
}

/**
 * The [limit] albums played most recently: an album's latest play is that of
 * its song played last; albums last played at the same time come by album id,
 * the highest (the latest added) first. [songs] are read latest played first;
 * [complete] says they are every played song. Null when they can't settle the
 * shelf yet: an album only counts once a song played after the last one read
 * names it, as a song not read yet may tie with that one. Read more and ask again.
 */
export const recentlyPlayedAlbums = (
  songs: readonly LatestPlayedSong[],
  limit: number,
  complete: boolean,
): readonly number[] | null => {
  const latest = new Map<number, number>();
  for (const song of songs) {
    if (!latest.has(song.albumId)) latest.set(song.albumId, song.lastPlayedAt);
  }
  const lastRead = songs.at(-1)?.lastPlayedAt;
  const settled = [...latest].filter(
    ([, playedAt]) => complete || lastRead === undefined || playedAt > lastRead,
  );
  if (!complete && settled.length < limit) return null;
  return (
    settled
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      .sort(([a, aAt], [b, bAt]) => bAt - aAt || b - a)
      .slice(0, limit)
      .map(([albumId]) => albumId)
  );
};
