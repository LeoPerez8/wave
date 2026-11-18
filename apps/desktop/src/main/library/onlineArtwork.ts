/**
 * Artwork no file on this computer carries: the cover of a missing song's album
 * and an artist's photo, found online by the lookups the phone shares
 * (`@wave/client/artworkLookup`) and kept on disk. A screen names a Library
 * identity; no address or path crosses the bridge.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { LibraryDatabase } from "@wave/client/db/database";
import { findArtistPhoto, findSongCover } from "@wave/client/artworkLookup";
import {
  UNKNOWN_ALBUM,
  artistPhotoLookups,
  artistPhotosUnreachable,
  failuresInARow,
  streamedCoverUrl,
  type ArtistPhotoCheck,
  type ArtistPhotoUrls,
  type SongLookup,
} from "@wave/core";
import { readArtwork } from "./artwork.ts";

export type ArtworkKind = "song" | "album" | "artist";

/** What a lookup is for: where its files go, the local cover it has, and how to find one online. */
interface Subject {
  /** Names the cache folder: one per album, per loose song and per artist. */
  readonly cache: string;
  /** A cover the Library already has (an artist's is an album's cover). */
  readonly hash: string | null;
  /** The name Core decides by whether this is ever looked up. */
  readonly name: string;
  readonly find: (signal: AbortSignal) => Promise<ArtistPhotoUrls | null>;
}

const MAX_DOWNLOAD = 8 * 1024 * 1024;
const MAX_DISPLAY = 2 * 1024 * 1024;
/** Cached subjects kept on disk; the oldest go first. */
const MAX_CACHED = 2000;
/** Lookups in flight or waiting. Past it a screen keeps its placeholder until it asks again. */
const MAX_QUEUED = 200;
const CONCURRENT = 2;
/** An album is searched by its first missing songs, until one is found. */
const SONGS_TRIED = 3;
/** After Core counts the service unreachable, nothing is asked for this long. */
const UNREACHABLE_PAUSE_MS = 60_000;

export const createLibraryArtwork = (options: {
  readonly db: LibraryDatabase;
  readonly directory: string;
  readonly process: (
    bytes: Buffer,
  ) => { readonly thumb: Buffer; readonly medium: Buffer } | undefined;
  readonly fetch?: typeof globalThis.fetch;
  /** Settings › Find lyrics and genre online: a cover lookup sends the same about a song. */
  readonly coversEnabled?: () => boolean;
  /** Settings › Download artist photos. */
  readonly photosEnabled?: () => boolean;
  /** The cover of a video's album on YouTube Music (`missingSongCover`), asked while YT Music is on. */
  readonly videoCover?: (videoId: string) => Promise<string | null>;
  readonly ytMusicOn?: () => boolean;
}) => {
  const { db, directory } = options;
  const fetch = options.fetch ?? globalThis.fetch;
  const pending = new Map<string, Promise<void>>();
  const waiting: (() => void)[] = [];
  let running = 0;
  let failures = 0;
  let unreachableUntil = 0;
  let saves = 0;

  const artistSubject = (id: number): Subject | undefined => {
    const artist = db.get<{ key: string; name: string; hash: string | null }>(
      sql`SELECT key, name, artwork_hash AS hash FROM artists WHERE id=${id}`,
    );
    if (artist?.key === undefined || artist.key === null) return undefined;
    return {
      cache: `artist:${artist.key}`,
      hash: artist.hash,
      name: artist.name,
      find: async (signal) => {
        const [lookup] = artistPhotoLookups([artist], new Map(), 0);
        return lookup ? findArtistPhoto(lookup.name, lookup.query, signal, fetch) : null;
      },
    };
  };

  /** A song's cover is its album's; without an album tag it is the song's own. */
  const songSubject = (kind: "song" | "album", id: number): Subject | undefined => {
    const album =
      kind === "album"
        ? db.get<{ id: number; key: string; title: string; hash: string | null }>(
            sql`SELECT id, key, title, artwork_hash AS hash FROM albums WHERE id=${id}`,
          )
        : db.get<{ id: number; key: string; title: string; hash: string | null }>(
            sql`SELECT a.id, a.key, a.title, coalesce(t.artwork_hash, a.artwork_hash) AS hash
                FROM tracks t JOIN albums a ON a.id=t.album_id WHERE t.id=${id}`,
          );
    if (album?.id === undefined || album.id === null) return undefined;
    const loose = album.title === UNKNOWN_ALBUM || album.title === "";
    if (loose && kind === "album") return { ...NOTHING, hash: album.hash };
    const songs = db.all<SongLookup & { id: number; videoId: string | null }>(
      sql`SELECT t.id, t.title, t.artist_credit AS artist, t.duration_ms AS durationMs,
                 t.video_id AS videoId
          FROM tracks t
          WHERE t.path IS NULL AND (t.id=${loose ? id : -1} OR t.album_id=${loose ? -1 : album.id})
          ORDER BY t.disc_number, t.track_number, t.id LIMIT ${SONGS_TRIED}`,
    );
    const ytMusic = options.videoCover !== undefined && options.ytMusicOn?.() === true;
    const deezer = options.coversEnabled?.() !== false;
    // Neither source may be asked: nothing is looked up, so nothing is remembered as a miss.
    if (!deezer && !(ytMusic && songs.some((song) => song.videoId !== null)))
      return { ...NOTHING, hash: album.hash };
    const first = songs[0];
    // A song that has its file shows what the file carries.
    if (!first || (kind === "song" && !songs.some((song) => song.id === id) && loose))
      return { ...NOTHING, hash: album.hash };
    if (kind === "song" && !loose) {
      const missing = db.get<{ missing: number }>(
        sql`SELECT path IS NULL AS missing FROM tracks WHERE id=${id}`,
      );
      if (!missing?.missing) return { ...NOTHING, hash: album.hash };
    }
    return {
      cache: loose ? `song:${album.key}:${first.title}:${first.artist}` : `album:${album.key}`,
      hash: album.hash,
      name: first.artist,
      find: async (signal) => {
        // The phone's source first: the cover a download of the song's own video takes.
        for (const song of ytMusic ? songs : []) {
          if (song.videoId === null) continue;
          const url = await options.videoCover!(song.videoId).catch(() => null);
          if (url !== null) return { thumbUrl: url, largeUrl: streamedCoverUrl(url) };
        }
        for (const song of deezer ? songs : []) {
          const lookup = {
            title: song.title,
            artist: song.artist,
            durationMs: song.durationMs,
            album: loose ? null : album.title,
          };
          const urls = await findSongCover(lookup, signal, fetch);
          if (urls !== null) return urls;
        }
        return null;
      },
    };
  };

  const atomic = async (file: string, content: Buffer | string) => {
    await writeFile(`${file}.tmp`, content);
    await rename(`${file}.tmp`, file);
  };

  const download = async (url: string, signal: AbortSignal): Promise<Buffer> => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get("content-length") ?? 0) > MAX_DOWNLOAD)
      throw new Error("Image too large");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty image");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > MAX_DOWNLOAD) {
        await reader.cancel();
        throw new Error("Image too large");
      }
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  };

  const prune = async () => {
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length <= MAX_CACHED) return;
    const folders = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const path = join(directory, entry.name);
          return { path, time: (await stat(path)).mtimeMs };
        }),
    );
    folders.sort((a, b) => b.time - a.time);
    for (const folder of folders.slice(MAX_CACHED))
      await rm(folder.path, { recursive: true, force: true });
  };

  const readCheck = async (folder: string): Promise<ArtistPhotoCheck | undefined> => {
    try {
      const check: unknown = JSON.parse(await readFile(join(folder, "check.json"), "utf8"));
      if (typeof check !== "object" || check === null) return undefined;
      const { outcome, checkedAt } = check as Record<string, unknown>;
      return (outcome === "found" || outcome === "unmatched" || outcome === "failed") &&
        typeof checkedAt === "number"
        ? { outcome, checkedAt }
        : undefined;
    } catch {
      return undefined;
    }
  };

  /** Looks [subject] up when Core says it is due, and records how it went. */
  const lookUp = async (subject: Subject, folder: string): Promise<void> => {
    if (running >= CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
    try {
      const check = await readCheck(folder);
      const due = artistPhotoLookups(
        [{ key: folder, name: subject.name }],
        new Map(check ? [[folder, check]] : []),
        Date.now(),
      );
      if (due.length === 0 || Date.now() < unreachableUntil) return;
      let outcome: ArtistPhotoCheck["outcome"] = "failed";
      try {
        const signal = AbortSignal.timeout(30_000);
        const urls = await subject.find(signal);
        if (urls === null) outcome = "unmatched";
        else {
          const display = options.process(await download(urls.largeUrl, signal));
          if (!display || display.thumb.length > MAX_DISPLAY || display.medium.length > MAX_DISPLAY)
            throw new Error("Invalid image");
          await mkdir(folder, { recursive: true });
          await atomic(join(folder, "thumb.jpg"), display.thumb);
          await atomic(join(folder, "large.jpg"), display.medium);
          outcome = "found";
        }
      } catch {
        // No connection, or an image that can't be read: the placeholder stays.
      }
      failures = failuresInARow(failures, outcome);
      if (artistPhotosUnreachable(failures)) unreachableUntil = Date.now() + UNREACHABLE_PAUSE_MS;
      await mkdir(folder, { recursive: true });
      await atomic(join(folder, "check.json"), JSON.stringify({ outcome, checkedAt: Date.now() }));
      if (++saves % 50 === 1) await prune();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };

  const saved = async (folder: string, large: boolean): Promise<string | null> => {
    try {
      const bytes = await readFile(join(folder, large ? "large.jpg" : "thumb.jpg"));
      return `data:image/jpeg;base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  };

  /**
   * The picture of a Library song, album or artist, as a data URL; null for none.
   * Asks online at most once per album or artist, and again only when Core's
   * retry time for a miss has come.
   */
  return async (kind: ArtworkKind, id: number, large: boolean): Promise<string | null> => {
    const subject = kind === "artist" ? artistSubject(id) : songSubject(kind, id);
    if (!subject) return null;
    const local = () =>
      subject.hash ? readArtwork(db, subject.hash, large) : Promise.resolve(null);
    // A cover from a file wins; an artist's photo wins over the album cover standing in for it.
    if (subject.cache === "" || (kind !== "artist" && subject.hash)) return local();
    if (kind === "artist" && options.photosEnabled?.() === false) return local();
    const folder = join(directory, createHash("sha1").update(subject.cache).digest("hex"));
    try {
      const found = await saved(folder, large);
      if (found !== null) return found;
      let job = pending.get(folder);
      if (!job) {
        if (pending.size >= MAX_QUEUED) return await local();
        job = lookUp(subject, folder).finally(() => pending.delete(folder));
        pending.set(folder, job);
      }
      await job;
      return (await saved(folder, large)) ?? (await local());
    } catch {
      return local();
    }
  };
};

const NOTHING: Omit<Subject, "hash"> = { cache: "", name: "", find: async () => null };
