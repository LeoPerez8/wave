/**
 * What playlist reads and edits cost, counted per playlist since launch (or
 * the last `resetPlaylistWork`): stored YT Music songs decoded in JavaScript,
 * playlists whose mosaic and totals were worked out again, list and page
 * reads, appends, and the changes announced for them. A perf build reports it
 * with each flush, split into the playlists an import fills and the others
 * (`playlistWorkReport`), so a run shows an import's cost landing on its own
 * playlist alone. Kept free of Expo, like the queries that count into it.
 */

type Counts = Map<number, number>;

/** The counters, per playlist id where a playlist is known. */
export interface PlaylistWork {
  /** Stored YT Music songs parsed (Core's `readPlaylistYtSong`). */
  readonly decoded: ReadonlyMap<number, number>;
  /** Mosaics and totals worked out again (not taken from the revision cache). */
  readonly summarized: ReadonlyMap<number, number>;
  /** Playlist pages read (`selectPlaylist`). */
  readonly pageReads: ReadonlyMap<number, number>;
  /** Songs given to a playlist (`appendPlaylistSongs` calls). */
  readonly appends: ReadonlyMap<number, number>;
  /** Playlist changes announced for each playlist. */
  readonly notified: ReadonlyMap<number, number>;
  /** Playlist changes announced for every playlist at once (no ids: a create, a sync). */
  readonly notifiedAll: number;
  /** Library › Playlists reads (`selectPlaylists`). */
  readonly listReads: number;
}

const fresh = () => ({
  decoded: new Map() as Counts,
  summarized: new Map() as Counts,
  pageReads: new Map() as Counts,
  appends: new Map() as Counts,
  notified: new Map() as Counts,
  notifiedAll: 0,
  listReads: 0,
});

let work = fresh();

const add = (counts: Counts, playlistId: number, n: number): void => {
  if (n !== 0) counts.set(playlistId, (counts.get(playlistId) ?? 0) + n);
};

/** The counters so far. */
export const playlistWork = (): PlaylistWork => work;

/** Starts the counters again from zero (tests, benchmarks). */
export const resetPlaylistWork = (): void => {
  work = fresh();
};

/** Counts [n] stored songs of [playlistId] decoded. */
export const countDecoded = (playlistId: number, n = 1): void => add(work.decoded, playlistId, n);

/** Counts [playlistId]'s mosaic and totals worked out again. */
export const countSummarized = (playlistId: number): void => add(work.summarized, playlistId, 1);

/** Counts a read of [playlistId]'s page. */
export const countPageRead = (playlistId: number): void => add(work.pageReads, playlistId, 1);

/** Counts songs given to [playlistId]. */
export const countAppend = (playlistId: number): void => add(work.appends, playlistId, 1);

/** Counts a Library › Playlists read. */
export const countListRead = (): void => {
  work.listReads += 1;
};

/** Counts a playlist change announced for [playlistIds], or for every playlist when not given. */
export const countNotified = (playlistIds?: readonly number[]): void => {
  if (playlistIds === undefined) work.notifiedAll += 1;
  else for (const id of playlistIds) add(work.notified, id, 1);
};

/**
 * The counters as a perf flush reports them: each per-playlist counter split
 * into the playlists in [affected] (those an import fills) and the others.
 */
export const playlistWorkReport = (affected: readonly number[]): Record<string, number> => {
  const filling = new Set(affected);
  const report: Record<string, number> = {
    listReads: work.listReads,
    notifiedAll: work.notifiedAll,
  };
  for (const name of ["decoded", "summarized", "pageReads", "appends", "notified"] as const) {
    let mine = 0;
    let others = 0;
    for (const [id, n] of work[name]) {
      if (filling.has(id)) mine += n;
      else others += n;
    }
    report[`${name}.affected`] = mine;
    report[`${name}.unrelated`] = others;
  }
  return report;
};
