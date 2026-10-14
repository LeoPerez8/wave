/**
 * The songs of selected groups (albums, artists, genres, playlists)
 * as one list for the queue and playlist actions: the groups in the order the
 * list shows them, each group's songs in the order its own screen plays them.
 * A song an earlier group already brought is skipped (a duet shared by two
 * selected artists plays once); a group's own repeats stay, as on its screen
 * (a playlist holding a song twice).
 */
export const groupSongs = <T, K>(groups: readonly (readonly T[])[], keyOf: (song: T) => K): T[] => {
  const earlier = new Set<K>();
  const songs: T[] = [];
  for (const group of groups) {
    const fresh = group.filter((song) => !earlier.has(keyOf(song)));
    for (const song of fresh) earlier.add(keyOf(song));
    songs.push(...fresh);
  }
  return songs;
};
