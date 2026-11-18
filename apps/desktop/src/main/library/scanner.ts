/** Filesystem work stays in main; identity, reconciliation and storage come from Core/Client. */
import { readdir, stat, realpath } from "node:fs/promises";
import { watch, realpathSync, type FSWatcher } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import {
  explicitFromAdvisory,
  gainTags,
  isVoiceNoteOrRecording,
  normalizeTrack,
  scanPath,
  scanPathKey,
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
import { libraryCounts } from "@wave/client/db/counts";
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
  readonly quietMs?: number;
  readonly retryMs?: number;
}

const AUDIO = new Set(["mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav"]);

export const createScanner = ({
  db,
  platform,
  musicFolder,
  readTags,
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
  const watchFolder = (path: string) => {
    if (watches.has(path) || disposed) return;
    try {
      const watcher = watch(
        realpathSync.native(normalize(path)),
        { recursive: platform === "win32" },
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
    const files = new Map<string, { path: string; sizeBytes: number; modifiedAt: number }>();
    const visited = new Set<string>();
    const watched = new Set<string>();
    const nextRoots: ScanFolder[] = [];
    const walk = async (folder: string): Promise<void> => {
      if (disposed || excluded.some((path) => scanPathWithin(folder, path, platform))) return;
      const key = scanPathKey(folder, platform);
      if (visited.has(key)) return;
      visited.add(key);
      if (platform !== "win32") {
        watched.add(folder);
        watchFolder(folder);
      }
      const children = await readdir(folder, { withFileTypes: true });
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
        const linked = child.isSymbolicLink() ? await stat(path) : undefined;
        if (child.isDirectory() || linked?.isDirectory()) await walk(path);
        else if (
          (child.isFile() || linked?.isFile()) &&
          AUDIO.has(extname(path).slice(1).toLowerCase())
        ) {
          const info = await stat(path);
          files.set(scanPathKey(path, platform), {
            path,
            sizeBytes: info.size,
            modifiedAt: info.mtimeMs,
          });
          state = { ...state, filesFound: files.size };
        }
      }
    };
    for (const root of listRoots(db)) {
      watched.add(dirname(root.path));
      watchFolder(dirname(root.path));
      try {
        await walk(root.path);
        nextRoots.push({ path: root.path, available: true });
      } catch {
        // An incomplete walk says nothing about deletion, even if only one subtree failed.
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
    index.begin(
      roots,
      [...files.values()].map((file) => file.path),
      indexed,
    );
    state = { ...state, phase: "reading" };
    let batch: IndexedTrack[] = [];
    const save = () => {
      if (batch.length === 0) return;
      index.save(batch);
      batch = [];
      state = { ...state, revision: state.revision + 1 };
    };
    for (const [key, file] of files) {
      if (disposed) return;
      const previous = known.get(key);
      if (
        previous?.sizeBytes === file.sizeBytes &&
        previous.modifiedAt === file.modifiedAt &&
        previous.path === file.path
      ) {
        state = { ...state, filesUnchanged: state.filesUnchanged + 1 };
        continue;
      }
      const tags = await readTags(file.path);
      const track = {
        ...normalizeTrack({ ...tags, path: file.path }),
        ...file,
        sampleRate: tags.sampleRate ?? null,
        bitrateKbps: tags.bitrateKbps ?? null,
        artworkHash: null,
        hasLyrics: false,
        explicit: explicitFromAdvisory(tags.advisory ?? null),
        loudness: gainTags(tags.loudnessTags ?? {}),
      };
      if (
        isVoiceNoteOrRecording(
          track,
          roots.map((root) => root.path),
        )
      )
        index.skip([file]);
      else batch.push(track);
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
    markScanned(
      db,
      roots.filter((root) => root.available).map((root) => root.path),
      Date.now(),
    );
    state = { ...state, status: "done", revision: state.revision + 1 };
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
    include: async (path: string) => {
      await active;
      settings.include(await canonical(path));
      await refresh();
    },
    status: (): ScanStatus => state,
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
