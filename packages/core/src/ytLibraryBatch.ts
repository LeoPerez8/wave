/**
 * From YT Music's batch (docs/spec.md, "Importing playlists from a link",
 * From YT Music): the playlists Import made that are still to be read from
 * YouTube Music, kept on the phone so a Wave Android stopped reads the rest
 * when it starts again, in the same order. A read that failed stays, for its
 * playlist's line and Try Again.
 */

/** Waiting its turn to be read, or read and failed (its playlist stays empty). */
export type YtLibraryReadState = "waiting" | "failed";

/** A playlist Import made, to be read from YouTube Music. */
export interface YtLibraryRead {
  /** The YouTube Music playlist it's read from, without `VL`. */
  readonly source: string;
  /** The Wave playlist it fills. */
  readonly playlistId: number;
  /** That playlist's name as Import made it. */
  readonly name: string;
  /** Whether the read stops at the 5,000-song cap (`YT_PLAYLIST_SONG_CAP`). */
  readonly capped: boolean;
  readonly state: YtLibraryReadState;
}

/** The batch, in the order its playlists are read. */
export type YtLibraryBatch = readonly YtLibraryRead[];

/** [batch] with [reads] (the playlists an Import just made, in its order) waiting after it. */
export const queueYtLibraryReads = (
  batch: YtLibraryBatch,
  reads: readonly Omit<YtLibraryRead, "state">[],
): YtLibraryBatch => [
  ...batch,
  ...reads.map(({ source, playlistId, name, capped }) => ({
    source,
    playlistId,
    name,
    capped,
    state: "waiting" as const,
  })),
];

/**
 * The playlist to read next: the first one waiting. One being read when
 * Wave stopped is still waiting, so it's read again first.
 */
export const nextYtLibraryRead = (batch: YtLibraryBatch): YtLibraryRead | undefined =>
  batch.find((read) => read.state === "waiting");

/**
 * [batch] once [playlistId]'s playlist was read (its songs go to the link
 * import from then on), or was deleted: it's no longer in the batch.
 */
export const ytLibraryReadDone = (batch: YtLibraryBatch, playlistId: number): YtLibraryBatch =>
  batch.filter((read) => read.playlistId !== playlistId);

/** [batch] without the playlists deleted meanwhile: those not among [playlistIds], here or on another phone. */
export const pruneYtLibraryBatch = (
  batch: YtLibraryBatch,
  playlistIds: readonly number[],
): YtLibraryBatch => {
  const kept = new Set(playlistIds);
  return batch.filter((read) => kept.has(read.playlistId));
};

/**
 * [batch] once [playlistId]'s read failed (offline, refused, an answer Wave
 * can't read): its playlist stays empty, with Try Again, and the rest goes on.
 */
export const ytLibraryReadFailed = (batch: YtLibraryBatch, playlistId: number): YtLibraryBatch =>
  batch.map((read) =>
    read.playlistId === playlistId ? { ...read, state: "failed" as const } : read,
  );

/** What a playlist's page shows when its read failed: the line, and the read Try Again makes. */
export interface YtLibraryReadView {
  readonly line: string;
  readonly read: YtLibraryRead;
}

/** What [playlistId]'s page shows of its read: null unless it failed. */
export const ytLibraryReadView = (
  batch: YtLibraryBatch,
  playlistId: number,
): YtLibraryReadView | null => {
  const read = batch.find((queued) => queued.playlistId === playlistId);
  return read?.state === "failed" ? { line: "Couldn't read it from YouTube Music", read } : null;
};

/** The app log's line for [read] that failed because of [reason]; no song titles. */
export const ytLibraryReadLogLine = (read: YtLibraryRead, reason: string): string =>
  `Import of "${read.name}" from YouTube Music couldn't read the playlist (${reason}); it stays empty, with Try Again`;

// ---------------------------------------------------------------------------
// Kept while Wave is closed

const KEPT_VERSION = 1;

/** [batch] as kept on the phone (`readYtLibraryBatch`). */
export const writeYtLibraryBatch = (batch: YtLibraryBatch): string =>
  JSON.stringify({ version: KEPT_VERSION, batch });

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A kept playlist; null when unreadable. */
const readRead = (value: unknown): YtLibraryRead | null => {
  if (!isFields(value)) return null;
  const { source, playlistId, name, capped, state } = value;
  if (typeof source !== "string" || typeof playlistId !== "number" || typeof name !== "string") {
    return null;
  }
  if (typeof capped !== "boolean" || (state !== "waiting" && state !== "failed")) return null;
  return { source, playlistId, name, capped, state };
};

/**
 * The batch kept as [stored] (`writeYtLibraryBatch`), in its order; a
 * playlist kept unreadably is left out. Empty when nothing readable is kept.
 */
export const readYtLibraryBatch = (stored: string | null): YtLibraryBatch => {
  if (stored === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!isFields(value) || !Array.isArray(value.batch)) return [];
  return value.batch.map(readRead).filter((read): read is YtLibraryRead => read !== null);
};
