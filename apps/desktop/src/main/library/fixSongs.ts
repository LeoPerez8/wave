/**
 * Fix Songs on the desktop, as the phone's `fixEachSong`: for each song that lacks lyrics, a
 * genre, a track number, a year or a checked explicit flag (Core's `songsToFix`), what it lacks
 * is looked up (LRCLIB and Deezer), only that is written into its file (the shared Kotlin's
 * `tags.writeSong`, jaudiotagger) and the Library rereads the file. A run stops when the
 * services can't be reached (Core's `lookupsUnreachable`).
 */
import type { LibraryDatabase } from "@wave/client/db/database";
import { chunks } from "@wave/client/db/chunks";
import {
  advisoryTag,
  lookupsUnreachable,
  missingTags,
  songLookup,
  songTagOutcome,
  songsToFix,
  type ExplicitFlag,
  type FoundTags,
  type IndexedTags,
  type SongLookup,
  type SongTagOutcome,
  type TagWriteReport,
} from "@wave/core";
import { sql } from "drizzle-orm";
import type { FixSongsResult } from "../../shared/songActions.ts";

/** What `tags.writeSong` is given: what was found, only what the file lacks. */
export interface WriteSongParams {
  readonly path: string;
  readonly lyrics: string | null;
  readonly genre: string | null;
  readonly trackNumber: number | null;
  /** Only with the track number it belongs to. */
  readonly discNumber: number | null;
  readonly year: number | null;
  readonly advisory: 0 | 1 | null;
}

/** Writes into a file's tags: where each tag went, or the step that failed. */
export type WriteSong = (
  params: WriteSongParams,
) => Promise<TagWriteReport | { readonly failed: unknown }>;

export interface FixSongsPorts {
  readonly db: LibraryDatabase;
  readonly lookUp: (song: SongLookup, has: IndexedTags) => Promise<FoundTags | null>;
  readonly writeSong: WriteSong;
  /** Rereads a written file into the Library. */
  readonly reimport: (path: string) => Promise<void>;
  /**
   * The least time one song takes: keeps Deezer under its rate limit (50 requests every
   * 5 seconds, up to three a song), as on the phone.
   */
  readonly minMs?: number;
}

const SONG_MIN_MS = 400;

interface FixableSong extends IndexedTags {
  readonly id: number;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly durationMs: number;
  readonly path: string;
}

/** What the Library knows about [ids]' tags, in [ids]' order; missing songs have no file to fix. */
export const fixableSongs = (db: LibraryDatabase, ids: readonly number[]): FixableSong[] => {
  const found = new Map<number, FixableSong>();
  for (const part of chunks(ids))
    for (const song of db.all<{
      id: number;
      title: string;
      artist: string;
      album: string;
      durationMs: number;
      path: string | null;
      hasLyrics: number;
      genre: string | null;
      trackNumber: number | null;
      year: number | null;
      explicit: ExplicitFlag;
    }>(
      sql`SELECT t.id, t.title, t.artist_credit AS artist, a.title AS album,
        t.duration_ms AS durationMs, t.path, t.has_lyrics AS hasLyrics, g.name AS genre,
        t.track_number AS trackNumber, t.year, t.explicit
        FROM tracks t JOIN albums a ON a.id = t.album_id LEFT JOIN genres g ON g.id = t.genre_id
        WHERE t.id IN (${sql.join(
          part.map((id) => sql`${id}`),
          sql`, `,
        )})`,
    ))
      if (song.path !== null)
        found.set(song.id, { ...song, path: song.path, hasLyrics: song.hasLyrics === 1 });
  return ids.flatMap((id) => found.get(id) ?? []);
};

/** Fix Song for one song: a failure is an outcome, and the file is left as it was. */
const fixSong = async (ports: FixSongsPorts, song: FixableSong): Promise<SongTagOutcome> => {
  const lookup = songLookup(song);
  if (lookup === null) return { kind: "notFound" };
  const looked = await ports.lookUp(lookup, song);
  if (looked === null) return { kind: "failed", reason: "lookup" };
  const found = missingTags(looked, song);
  const advisory = advisoryTag(found.explicit);
  if (
    found.lyrics === null &&
    found.genre === null &&
    found.trackNumber === null &&
    found.year === null &&
    advisory === null
  )
    return songTagOutcome(found, null);
  let written: Awaited<ReturnType<WriteSong>>;
  try {
    written = await ports.writeSong({
      path: song.path,
      lyrics: found.lyrics?.text ?? null,
      genre: found.genre,
      trackNumber: found.trackNumber,
      discNumber: found.trackNumber === null ? null : found.discNumber,
      year: found.year,
      advisory,
    });
  } catch {
    return { kind: "failed", reason: "write" };
  }
  if ("failed" in written) return { kind: "failed", reason: "write" };
  // The file has its new tags; a failed reread is caught up by the next scan.
  await ports.reimport(song.path).catch(() => {});
  return songTagOutcome(found, written);
};

/** Fix Song on [ids], one after another; what each came to, for the toast. */
export const fixSongs = async (
  ports: FixSongsPorts,
  ids: readonly number[],
): Promise<FixSongsResult> => {
  const { fix, skipped } = songsToFix(fixableSongs(ports.db, ids));
  const minMs = ports.minMs ?? SONG_MIN_MS;
  const results: { title: string; outcome: SongTagOutcome }[] = [];
  for (const [index, song] of fix.entries()) {
    const startedAt = Date.now();
    const outcome = await fixSong(ports, song);
    results.push({ title: song.title, outcome });
    if (lookupsUnreachable(results.map((result) => result.outcome)))
      return {
        results,
        skipped,
        stop: { stopped: "unreachable", left: fix.length - index - 1 },
      };
    const spent = Date.now() - startedAt;
    if (spent < minMs) await new Promise((resolve) => setTimeout(resolve, minMs - spent));
  }
  return { results, skipped };
};
