/** Filesystem work stays in main; identity, reconciliation and storage come from Core/Client. */
import { readdir, readFile, stat, realpath } from "node:fs/promises";
import { watch, realpathSync, type FSWatcher } from "node:fs";
import { basename, dirname, extname, join, normalize } from "node:path";
import {
  explicitFromAdvisory,
  isrcFromTag,
  gainTags,
  isVoiceNoteOrRecording,
  normalizeTrack,
  pickLyrics,
  scanPath,
  scanPathKey,
  type Lyrics,
  type ScanFolder,
} from "@wave/core";
import type { LibraryDatabase } from "@wave/client/db/database";
import { desktopScanIndex } from "@wave/client/db/desktopScan";
import { desktopFolders, desktopRoots } from "@wave/client/db/desktopFolders";
import {
  ensureDefaultRoot,
  listRoots,
  excludedFolders,
  markScanned,
} from "@wave/client/db/libraryQueries";
import { trackQuery, BY_TITLE } from "@wave/client/db/tracks";
import { creditSplits } from "@wave/client/db/credits";
import { removeSongs } from "@wave/client/db/missingSongs";
import { saveBatch } from "@wave/client/db/save";
import { chunks } from "@wave/client/db/chunks";
import { excludedFolders as exclusions, tracks } from "@wave/client/db/schema";
import { inArray } from "drizzle-orm";
import { libraryCounts } from "@wave/client/db/counts";
import { keepLyricsSearchText, selectLyricsTrackIdAtPath } from "@wave/client/db/lyricsSearchIndex";
import { scanPathWithin } from "@wave/core";
import type { IndexedTrack } from "@wave/client";
import type { Page } from "../../shared/bridge.ts";
import type { DesktopFolder, DesktopSong, ScanStatus } from "../../shared/library.ts";
import type { SongTags } from "../../shared/tags.ts";

export interface ScannerOptions {
  readonly db: LibraryDatabase;
  readonly platform: string;
  readonly musicFolder: string;
  readonly readTags: (path: string) => Promise<Partial<SongTags>>;
  readonly cacheArtwork?: (encoded: string) => Promise<string | null>;
  readonly forceTags?: boolean;
  readonly tagsUpdated?: () => void;
  readonly quietMs?: number;
  readonly retryMs?: number;
}

/** The words Search finds a song by: its lyrics' lines, without times. */
const plainText = (lyrics: Lyrics): string | null =>
  lyrics.kind === "synced"
    ? lyrics.lines.map((line) => line.text).join("\n")
    : lyrics.kind === "unsynced"
      ? lyrics.lines.join("\n")
      : null;

/**
 * [audio]'s sidecar `.lrc` text: `Song.lrc` beside `Song.mp3`, or `Song.mp3.lrc`, names matching
 * ignoring case (the shared Kotlin's `Sidecars.find`). [names] caches each folder's `.lrc` files.
 */
const readSidecar = async (
  audio: string,
  names: Map<string, Promise<Map<string, string>>>,
): Promise<string | null> => {
  const folder = dirname(audio);
  let listing = names.get(folder);
  if (listing === undefined) {
    listing = readdir(folder).then(
      (files) =>
        new Map(
          files
            .filter((name) => extname(name).toLowerCase() === ".lrc")
            .map((name) => [name.toLowerCase(), name]),
        ),
      () => new Map(),
    );
    names.set(folder, listing);
  }
  const files = await listing;
  const name = basename(audio);
  const wanted = [`${name.slice(0, name.length - extname(name).length)}.lrc`, `${name}.lrc`];
  for (const candidate of wanted) {
    const found = files.get(candidate.toLowerCase());
    if (found !== undefined)
      try {
        return await readFile(join(folder, found), "utf8");
      } catch {
        return null;
      }
  }
  return null;
};

const AUDIO = new Set(["mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav"]);

export const createScanner = ({
  db,
  platform,
  musicFolder,
  readTags,
  cacheArtwork,
  forceTags = false,
  tagsUpdated,
  quietMs = 2000,
  retryMs = 10000,
}: ScannerOptions) => {
  const canonical = async (path: string) => {
    try {
      return scanPath(await realpath(path), platform);
    } catch {
      return scanPath(path, platform);
    }
  };
  let initialized = false;
  let rereadTags = forceTags;
  const upgraded = new Set<string>();
  let rootPaths: readonly string[] = [];
  const index = desktopScanIndex(db, platform);
  const settings = desktopFolders(db, platform);
  let state: ScanStatus = {
    status: "idle",
    phase: "discovering",
    filesFound: 0,
    filesRead: 0,
    filesUnchanged: 0,
    revision: 0,
  };
  let roots: readonly ScanFolder[] = [];
  let disposed = false;
  /** Hear each change to the song list. */
  const listeners = new Set<() => void>();
  let active: Promise<void> | undefined;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watches = new Map<string, FSWatcher>();
  let watchFailed = false;
  const schedule = () => {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void refresh();
    }, quietMs);
    timer.unref();
  };
  const watchFolder = (path: string, recursive = false) => {
    if (watches.has(path) || disposed) return;
    try {
      const watcher = watch(
        realpathSync.native(normalize(path)),
        { recursive },
        (_event, filename) => {
          if (filename === null) {
            schedule();
            return;
          }
          const changed = scanPath(join(path, String(filename)), platform);
          if (
            rootPaths.some(
              (root) =>
                scanPathWithin(changed, root, platform) || scanPathWithin(root, changed, platform),
            )
          )
            schedule();
        },
      );
      watcher.on("error", () => {
        watcher.close();
        watches.delete(path);
        schedule();
      });
      watcher.unref();
      watches.set(path, watcher);
    } catch {
      // Inotify limits and unavailable parent directories fall back to reconciliation.
      watchFailed = true;
    }
  };
  const retry = setInterval(() => {
    if (watchFailed || roots.some((root) => !root.available)) schedule();
  }, retryMs);
  retry.unref();

  /** The Library's row for [file], from the [tags] read from it and its [lyrics]' text. */
  const trackOf = async (
    file: { readonly path: string; readonly sizeBytes: number; readonly modifiedAt: number },
    tags: Partial<SongTags>,
    lyrics: string | null,
  ): Promise<IndexedTrack> => ({
    ...normalizeTrack({ ...tags, path: file.path }),
    ...file,
    sampleRate: tags.sampleRate ?? null,
    bitrateKbps: tags.bitrateKbps ?? null,
    artworkHash: tags.artworkBase64 && cacheArtwork ? await cacheArtwork(tags.artworkBase64) : null,
    hasLyrics: lyrics !== null,
    explicit: explicitFromAdvisory(tags.advisory ?? null),
    loudness: gainTags(tags.loudnessTags ?? {}),
    isrc: isrcFromTag(tags.isrc),
  });

  const scan = async () => {
    if (!initialized) {
      ensureDefaultRoot(db, await canonical(musicFolder));
      initialized = true;
    }
    rootPaths = listRoots(db).map((root) => root.path);
    // A remounted root can have new inodes under the same paths. Rebuild handles each scan.
    for (const watcher of watches.values()) watcher.close();
    watches.clear();
    watchFailed = false;
    state = {
      status: "scanning",
      phase: "discovering",
      filesFound: 0,
      filesRead: 0,
      filesUnchanged: 0,
      revision: state.revision,
    };
    const excluded = excludedFolders(db);
    // A song removed from the Library is its file's own exclusion.
    const excludedFiles = new Set(excluded.map((path) => scanPathKey(path, platform)));
    const files = new Map<string, { path: string; sizeBytes: number; modifiedAt: number }>();
    const visited = new Set<string>();
    const watched = new Set<string>();
    const nextRoots: ScanFolder[] = [];
    /** Folders and links inside a root that couldn't be read: what the Library has there stays. */
    const unreadable: string[] = [];
    /** Whether [error] says the entry is gone, which is a deletion; any other says nothing. */
    const gone = (error: unknown) =>
      ["ENOENT", "ENOTDIR"].includes((error as { code?: string }).code ?? "");
    /** Only a root that can't be read fails its walk; an entry inside it is skipped. */
    const walk = async (folder: string, root = false): Promise<void> => {
      if (disposed || excluded.some((path) => scanPathWithin(folder, path, platform))) return;
      const key = scanPathKey(folder, platform);
      if (visited.has(key)) return;
      visited.add(key);
      if (platform !== "win32") {
        watched.add(folder);
        watchFolder(folder);
      }
      let children;
      try {
        children = await readdir(folder, { withFileTypes: true });
      } catch (error) {
        if (root) throw error;
        if (!gone(error)) unreadable.push(folder);
        return;
      }
      children.sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        if (disposed) return;
        if (child.name.startsWith(".")) continue;
        const path = child.isSymbolicLink()
          ? await canonical(join(folder, child.name))
          : scanPath(join(folder, child.name), platform);
        // As on the phone, canonical paths prevent loops and repeated files. A link outside
        // the selected roots belongs to its own root, so it cannot leave an unowned Track.
        if (!rootPaths.some((root) => scanPathWithin(path, root, platform))) continue;
        try {
          const linked = child.isSymbolicLink() ? await stat(path) : undefined;
          if (child.isDirectory() || linked?.isDirectory()) await walk(path);
          else if (
            (child.isFile() || linked?.isFile()) &&
            AUDIO.has(extname(path).slice(1).toLowerCase()) &&
            !excludedFiles.has(scanPathKey(path, platform))
          ) {
            const info = await stat(path);
            files.set(scanPathKey(path, platform), {
              path,
              sizeBytes: info.size,
              modifiedAt: info.mtimeMs,
            });
            state = { ...state, filesFound: files.size };
          }
        } catch (error) {
          if (!gone(error)) unreadable.push(path);
        }
      }
    };
    // Windows watches a root's whole tree in one recursive watch; elsewhere the walk watches each
    // folder. These go first: a root can be another's parent, or its own (a drive).
    if (platform === "win32")
      for (const root of listRoots(db)) {
        watched.add(root.path);
        watchFolder(root.path, true);
      }
    for (const root of listRoots(db)) {
      // The parent hears the root itself come and go.
      watched.add(dirname(root.path));
      watchFolder(dirname(root.path));
      try {
        await walk(root.path, true);
        nextRoots.push({ path: root.path, available: true });
      } catch {
        nextRoots.push({ path: root.path, available: false });
      }
    }
    roots = nextRoots;
    for (const [path, watcher] of watches)
      if (!watched.has(path)) {
        watcher.close();
        watches.delete(path);
      }
    const indexed = index.known();
    const known = new Map(
      [...indexed, ...index.skipped()].map((file) => [scanPathKey(file.path, platform), file]),
    );
    // An entry that couldn't be read says nothing about deletion: its files count as seen.
    const kept = [...known.values()]
      .map((file) => file.path)
      .filter((path) => unreadable.some((entry) => scanPathWithin(path, entry, platform)));
    index.begin(roots, [...[...files.values()].map((file) => file.path), ...kept], indexed);
    state = { ...state, phase: "reading" };
    let batch: IndexedTrack[] = [];
    /** The lyrics text Search indexes for each file in [batch]; null takes a song out. */
    let lyricsOf = new Map<string, string | null>();
    const sidecars = new Map<string, Promise<Map<string, string>>>();
    const save = () => {
      if (batch.length === 0) return;
      index.save(batch);
      for (const [path, text] of lyricsOf) {
        const id = selectLyricsTrackIdAtPath(db, path);
        if (id !== null) keepLyricsSearchText(db, id, text);
      }
      batch = [];
      lyricsOf = new Map();
      state = { ...state, revision: state.revision + 1 };
    };
    for (const [key, file] of files) {
      if (disposed) return;
      const previous = known.get(key);
      if (
        (!rereadTags || upgraded.has(key)) &&
        previous?.sizeBytes === file.sizeBytes &&
        previous.modifiedAt === file.modifiedAt &&
        previous.path === file.path
      ) {
        state = { ...state, filesUnchanged: state.filesUnchanged + 1 };
        continue;
      }
      const tags = await readTags(file.path);
      if (rereadTags) upgraded.add(key);
      const lyrics = plainText(
        pickLyrics({
          embedded: tags.lyrics ?? null,
          sidecar: await readSidecar(file.path, sidecars),
        }),
      );
      const track = await trackOf(file, tags, lyrics);
      if (
        isVoiceNoteOrRecording(
          track,
          roots.map((root) => root.path),
        )
      )
        index.skip([file]);
      else {
        batch.push(track);
        lyricsOf.set(track.path, lyrics);
      }
      state = { ...state, filesRead: state.filesRead + 1 };
      if (batch.length >= 100) save();
    }
    if (disposed) return;
    save();
    roots = await Promise.all(
      roots.map(async (root) => {
        if (!root.available) return root;
        try {
          await readdir(root.path);
          return root;
        } catch {
          return { ...root, available: false };
        }
      }),
    );
    index.finish(roots);
    // An unavailable root must be revisited before completing this one-time upgrade.
    if (roots.every((root) => root.available)) {
      rereadTags = false;
      upgraded.clear();
      tagsUpdated?.();
    }
    markScanned(
      db,
      roots.filter((root) => root.available).map((root) => root.path),
      Date.now(),
    );
    state = { ...state, status: "done", revision: state.revision + 1 };
    for (const listener of listeners) listener();
  };

  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (active !== undefined) {
      again = true;
      return active;
    }
    active = (async () => {
      do {
        again = false;
        try {
          await scan();
        } catch (error) {
          state = { ...state, status: "failed", error: String(error) };
        }
      } while (again && !disposed);
    })().finally(() => {
      active = undefined;
    });
    return active;
  };

  return {
    refresh,
    resolvePath: canonical,
    addRoot: async (path: string) => {
      await active;
      settings.add(await canonical(path));
      await refresh();
    },
    removeRoot: async (path: string) => {
      await active;
      settings.remove(await canonical(path));
      await refresh();
    },
    exclude: async (path: string) => {
      await active;
      settings.exclude(await canonical(path));
      await refresh();
    },
    /**
     * Takes songs out of the Library, as the phone's Remove from Library does: their files
     * stay on disk, excluded from later scans until Settings includes them again.
     */
    removeSongs: async (trackIds: readonly number[]) => {
      await active;
      db.transaction((tx) => {
        for (const ids of chunks(trackIds)) {
          const paths = tx
            .select({ path: tracks.path })
            .from(tracks)
            .where(inArray(tracks.id, ids))
            .all()
            .flatMap((row) => (row.path === null ? [] : [{ path: row.path, addedAt: Date.now() }]));
          if (paths.length > 0) tx.insert(exclusions).values(paths).onConflictDoNothing().run();
        }
      });
      removeSongs(db, creditSplits(), trackIds, Date.now());
      state = { ...state, revision: state.revision + 1 };
      for (const listener of listeners) listener();
    },
    include: async (path: string) => {
      await active;
      settings.include(await canonical(path));
      await refresh();
    },
    /**
     * Puts the file a download saved at [path] in the Library now, as the phone's
     * `importDownload` does: with the YouTube Music video it came from, filling in missing song
     * [fills] when it was one. A scan later finds it unchanged. A file Fix Songs retagged is
     * read again the same way.
     */
    importFile: async (
      path: string,
      made: { readonly videoId: string | null; readonly fills: number | null } = {
        videoId: null,
        fills: null,
      },
    ) => {
      await active;
      const file = scanPath(await realpath(path).catch(() => path), platform);
      const info = await stat(file);
      const tags = await readTags(file);
      const lyrics = plainText(
        pickLyrics({ embedded: tags.lyrics ?? null, sidecar: await readSidecar(file, new Map()) }),
      );
      const track = await trackOf(
        { path: file, sizeBytes: info.size, modifiedAt: info.mtimeMs },
        tags,
        lyrics,
      );
      saveBatch(
        db,
        creditSplits(),
        [
          {
            ...track,
            ...(made.videoId === null ? {} : { videoId: made.videoId }),
            ...(made.fills === null ? {} : { fills: made.fills }),
          },
        ],
        [],
        [],
        Date.now(),
      );
      const id = selectLyricsTrackIdAtPath(db, file);
      if (id !== null) keepLyricsSearchText(db, id, lyrics);
      state = { ...state, revision: state.revision + 1 };
      for (const listener of listeners) listener();
    },
    status: (): ScanStatus => state,
    /** Hears each change to the song list (a scan that finished, an import, a removal); the Wave account's sync looks at it then. */
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    folders: (offset = 0, limit = 100): Page<DesktopFolder> => {
      const items = desktopRoots(db, platform).map((root) => ({
        ...root,
        available: roots.find((row) => row.path === root.path)?.available ?? false,
      }));
      return { items: items.slice(offset, offset + limit), offset, total: items.length };
    },
    exclusions: (offset = 0, limit = 100): Page<string> => {
      const items = excludedFolders(db);
      return { items: items.slice(offset, offset + limit), offset, total: items.length };
    },
    songs: (offset: number, limit: number): Page<DesktopSong> => ({
      items: trackQuery(db)
        .orderBy(...BY_TITLE)
        .limit(limit)
        .offset(offset)
        .all()
        .map((row) => ({
          id: row.id,
          path: row.path,
          title: row.title,
          artist: row.artist,
          album: row.album,
          unavailable: row.path !== null && index.unavailable(row.path),
        })),
      offset,
      total: libraryCounts(db).songs,
    }),
    unavailable: index.unavailable,
    dispose: async () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(retry);
      for (const watcher of watches.values()) watcher.close();
      watches.clear();
      await active;
    },
  };
};
