/**
 * When the recommendation snapshot is read again (docs/spec.md, "Recommendation
 * snapshot"): Home's mixes, the Magic Queue radio, playlist suggestions and the
 * harvest share one read of each of its parts (the Library, the candidate
 * catalog, the artist graph). A write never cancels a read under way: it goes
 * into the next one, which whoever asks after the write waits for.
 */
import type { LibraryDataKind } from "./libraryQueries.ts";

/** What a snapshot part is read from: Library data, the candidate catalog, or the saved artist pages' similar artists. */
export type SnapshotSource = LibraryDataKind | "catalog" | "similar";

/** How many writes each source has had (absent: none), as the app counts them. */
export type SnapshotVersions = Readonly<Partial<Record<SnapshotSource, number>>>;

/** One part of the snapshot: the sources it's read from, and how long it's kept unused (absent: for the session). */
export interface SnapshotPart {
  readonly sources: readonly SnapshotSource[];
  readonly idleMs?: number;
}

/** A part's latest read, as `snapshotAsk` weighs it. */
export interface SnapshotReadState {
  /** The sources' versions when the read started; null while it waits for the read before it to end. */
  readonly versions: SnapshotVersions | null;
  /** Whether it has its answer. */
  readonly done: boolean;
  /** When it was last asked for or finished (ms). */
  readonly usedAt: number;
}

/**
 * What an ask gets: the latest read's answer ("share", waiting while it's
 * read), a read started now ("read"), or a read started once the one under
 * way ends ("read-after"), which that read's own waiters never wait for.
 */
export type SnapshotAnswer = "share" | "read" | "read-after";

/**
 * What an ask for [part] at [now] gets, given its [latest] read and the
 * sources' [versions] now. The latest read is stale once one of the part's
 * sources was written since it started: a finished one is read again, one
 * under way finishes for those already waiting and the next read starts
 * after it. A finished read nobody used for the part's `idleMs` is read again.
 */
export const snapshotAsk = (
  part: SnapshotPart,
  latest: SnapshotReadState | null,
  versions: SnapshotVersions,
  now: number,
): SnapshotAnswer => {
  if (latest === null) return "read";
  // Not started yet: it will read every write so far.
  if (latest.versions === null) return "share";
  const read = latest.versions;
  if (part.sources.some((source) => (read[source] ?? 0) !== (versions[source] ?? 0)))
    return latest.done ? "read" : "read-after";
  if (latest.done && part.idleMs !== undefined && now - latest.usedAt > part.idleMs) return "read";
  return "share";
};

/** [versions] after one more write to [source]. */
export const snapshotVersionsAfter = (
  versions: SnapshotVersions,
  source: SnapshotSource,
): SnapshotVersions => ({ ...versions, [source]: (versions[source] ?? 0) + 1 });

/** The snapshot's parts. */
export const RECOMMENDATION_SNAPSHOT = {
  library: { sources: ["tracks", "plays", "playlists", "streamed"], idleMs: 60_000 },
  catalog: { sources: ["catalog"], idleMs: 60_000 },
  graph: { sources: ["tracks", "plays", "catalog", "similar"] },
  /** Which songs are starred or downloaded, for playlist suggestions: kept apart so a star doesn't re-read the Library. */
  favorites: { sources: ["tracks", "favorites"], idleMs: 60_000 },
} as const satisfies Record<string, SnapshotPart>;
