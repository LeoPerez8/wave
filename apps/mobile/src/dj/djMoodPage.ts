/**
 * One page of the DJ mood lookup (`djMoodLookup.ts`): what each of its candidate songs is saved
 * as. The requests and free turns are the worker's ports, so this runs in node tests too.
 */
import { djMedianAudioFeatures, type DjAudioFeatures } from "@wave/core";
import type {
  DjMoodFeatureWrite,
  DjMoodLookupPage,
  DjMoodLookupSong,
} from "@wave/client/db/djMoodFeatures";

export interface DjMoodPagePorts {
  /** Whether the lookup may go on (Wave on screen, the phone online). */
  readonly enabled: () => boolean;
  /** Waits for a free turn for the lookup's [step] ("ISRCs", "search fallback"). */
  readonly turn: (step: string) => Promise<void>;
  /** The song's ISRC from the Deezer track Wave's matcher picks, or null with none. */
  readonly deezerIsrc: (song: DjMoodLookupSong) => Promise<string | null>;
  /** The song's ReccoBeats id from its search, or null with no match. */
  readonly searchFallback: (song: DjMoodLookupSong) => Promise<string | null>;
  /** ReccoBeats' feature rows for [ids] (ISRCs or its own ids). */
  readonly featureRows: (ids: readonly string[]) => Promise<readonly Record<string, unknown>[]>;
  readonly now: () => number;
}

const asFeatures = (value: unknown): DjAudioFeatures | null => {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  for (const key of ["energy", "valence", "acousticness"])
    if (typeof row[key] !== "number" || row[key] < 0 || row[key] > 1) return null;
  if (row.mode !== 0 && row.mode !== 1) return null;
  return {
    energy: row.energy as number,
    valence: row.valence as number,
    acousticness: row.acousticness as number,
    mode: row.mode,
  };
};

const medianFeatures = (rows: readonly unknown[]): DjAudioFeatures | null => {
  const features = rows.flatMap((row) => {
    const value = asFeatures(row);
    return value === null ? [] : [value];
  });
  return djMedianAudioFeatures(features);
};

/** What a page's songs are saved as, or null when the lookup stopped before it was done. */
const lookUp = async (
  page: readonly DjMoodLookupSong[],
  ports: DjMoodPagePorts,
): Promise<{
  readonly isrcs: ReadonlyMap<string, string>;
  readonly fallbackIsrcs: ReadonlyMap<string, string>;
  readonly featureByVideo: ReadonlyMap<string, DjAudioFeatures>;
  readonly unavailable: ReadonlySet<string>;
} | null> => {
  const { enabled, turn, deezerIsrc, searchFallback, featureRows } = ports;
  const isrcs = new Map<string, string>();
  const unavailable = new Set<string>();
  for (const song of page) {
    await turn("ISRCs");
    if (!enabled()) return null;
    try {
      const isrc = await deezerIsrc(song);
      if (isrc !== null) isrcs.set(song.videoId, isrc);
    } catch {
      unavailable.add(song.videoId);
    }
  }
  const codes = [...new Set(isrcs.values())];
  const byIsrc = new Map<string, Record<string, unknown>[]>();
  // A failed feature read fails only this page's ISRC songs, not the whole pass;
  // they go on to the search fallback like a miss.
  const foundRows = await featureRows(codes).catch(() => {
    for (const song of page) if (isrcs.has(song.videoId)) unavailable.add(song.videoId);
    return [];
  });
  for (const row of foundRows) {
    if (typeof row.isrc !== "string") continue;
    const code = row.isrc.toUpperCase();
    const rows = byIsrc.get(code) ?? [];
    rows.push(row);
    byIsrc.set(code, rows);
  }
  const featureByVideo = new Map<string, DjAudioFeatures>();
  const misses: DjMoodLookupSong[] = [];
  for (const song of page) {
    const code = isrcs.get(song.videoId);
    const features = code === undefined ? null : medianFeatures(byIsrc.get(code) ?? []);
    if (features !== null) featureByVideo.set(song.videoId, features);
    else misses.push(song);
  }
  const fallbackIds = new Map<string, string>();
  const fallbackIsrcs = new Map<string, string>();
  for (const song of misses) {
    await turn("search fallback");
    if (!enabled()) return null;
    try {
      const id = await searchFallback(song);
      if (id !== null) fallbackIds.set(song.videoId, id);
    } catch {
      unavailable.add(song.videoId);
    }
  }
  const fallbackRows = await featureRows([...new Set(fallbackIds.values())]).catch(() => {
    for (const videoId of fallbackIds.keys()) unavailable.add(videoId);
    fallbackIds.clear();
    return [];
  });
  const byId = new Map(fallbackRows.map((row) => [String(row.id), row]));
  for (const [videoId, id] of fallbackIds) {
    const row = byId.get(id);
    const features = medianFeatures(row === undefined ? [] : [row]);
    if (features !== null) featureByVideo.set(videoId, features);
    if (typeof row?.isrc === "string") fallbackIsrcs.set(videoId, row.isrc.toUpperCase());
  }
  if (!enabled()) return null;
  return { isrcs, fallbackIsrcs, featureByVideo, unavailable };
};

/**
 * The writes for [pending]: a match, a miss, or a failure (`DJ_MOOD_RETRY_MS`, then
 * `DJ_MOOD_MAX_FAILURES`) for each song, and a miss for each stored entry that no longer reads.
 * An answer the page can't read fails all of its songs (#1449): left unsaved, they were due
 * again on every pass the catalog started. Null when the lookup stopped before the page was done.
 */
export const djMoodPageWrites = async (
  pending: DjMoodLookupPage,
  ports: DjMoodPagePorts,
): Promise<DjMoodFeatureWrite[] | null> => {
  let found: Awaited<ReturnType<typeof lookUp>>;
  try {
    found = await lookUp(pending.songs, ports);
  } catch {
    found = {
      isrcs: new Map(),
      fallbackIsrcs: new Map(),
      featureByVideo: new Map(),
      unavailable: new Set(pending.songs.map(({ videoId }) => videoId)),
    };
  }
  if (found === null) return null;
  const { isrcs, fallbackIsrcs, featureByVideo, unavailable } = found;
  const checkedAt = ports.now();
  // A stored entry that no longer reads can't be looked up: it waits as a miss.
  return [
    ...pending.songs.map((song) =>
      unavailable.has(song.videoId) && !featureByVideo.has(song.videoId)
        ? { videoId: song.videoId, isrc: null, features: null, checkedAt, failed: true }
        : {
            videoId: song.videoId,
            isrc: isrcs.get(song.videoId) ?? fallbackIsrcs.get(song.videoId) ?? null,
            features: featureByVideo.get(song.videoId) ?? null,
            checkedAt,
          },
    ),
    ...pending.unreadable.map((videoId) => ({
      videoId,
      isrc: null,
      features: null,
      checkedAt,
    })),
  ];
};
