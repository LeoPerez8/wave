/**
 * Downloads as a service of main: the journal ([createDownloads]) answered from the Library, the
 * settings, YT Music, Soulseek and the lookups ([createAnswers]), the folder downloads go to,
 * and Fix Songs, which shares the lookups. The journal pauses while the computer is offline.
 */
import { Database } from "@wave/client";
import { desktopRoots } from "@wave/client/db/desktopFolders";
import { excludedFolders } from "@wave/client/db/libraryQueries";
import { selectAlbumsMissingSongs, selectMissingSongs } from "@wave/client/db/missingSongs";
import { selectFavoriteTrackIds } from "@wave/client/db/playHistory";
import {
  albumDownloadOrigin,
  playlistDownloadOrigin,
  type AppLanguage,
  type Catalogue,
  type SoulseekCandidate,
  type TagWriteReport,
  type YtAlbum,
} from "@wave/core";
import { sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { FixSongsResult } from "../../shared/songActions.ts";
import { Kotlin } from "../kotlin/kotlin.ts";
import type { KotlinEvent } from "../kotlin/protocol.ts";
import { browseRows, browseTrackIds } from "../library/browse.ts";
import { fixSongs, type FixSongsRunOptions } from "../library/fixSongs.ts";
import { createLibraryFixRun, type LibraryFixRun } from "../library/lyricsAndTags.ts";
import { DesktopLibrary } from "../library/library.ts";
import { preference, savePreference } from "../preferences.ts";
import { YtMusic } from "../yt/ytMusic.ts";
import { createAnswers } from "./decisions.ts";
import { createDownloads, type DownloadCall, type DownloadsShape } from "./downloads.ts";
import { createLookups } from "@wave/client/downloads/lookups";
import { lookupsEnabled } from "../lookupSettings.ts";

/** The folder new downloads go to (Settings › Downloads); a scan root. */
export const DOWNLOADS_FOLDER = "downloads.folder";
const ONLINE_EVERY_MS = 3_000;

export interface DesktopDownloadsShape extends DownloadsShape {
  /** Where new downloads go. */
  readonly folder: () => string;
  /** Asks for the folder downloads go to; it joins the Library's folders. Null when cancelled. */
  readonly pickFolder: () => Promise<string | null>;
  /** Fix Songs on Tracks [ids]: the lookups' tags written into their files. */
  readonly fixSongs: (ids: readonly number[]) => Promise<FixSongsResult>;
  /** Fix songs in the whole Library (Settings › Lyrics and tags). */
  readonly libraryFix: LibraryFixRun;
}

export class Downloads extends Context.Service<Downloads, DesktopDownloadsShape>()(
  "@wave/desktop/Downloads",
) {}

export interface DownloadsLayerOptions {
  readonly catalogue: Catalogue;
  /** [catalogue]'s language; English by default. */
  readonly language?: () => AppLanguage;
  readonly platform: string;
  /** Where downloads go before any folder is picked or added. */
  readonly musicFolder: string;
  readonly pickFolder: () => Promise<string | undefined>;
  readonly online: () => boolean;
  /** What the JVM tells main unasked; returns how to stop listening. */
  readonly events: (listener: (event: KotlinEvent) => void) => () => void;
  readonly fetch?: typeof globalThis.fetch;
  readonly log?: (level: "info" | "warn", message: string) => void;
}

export const downloadsLayer = (options: DownloadsLayerOptions) =>
  Layer.effect(
    Downloads,
    Effect.gen(function* () {
      const db = yield* Database;
      const kotlin = yield* Kotlin;
      const library = yield* DesktopLibrary;
      const yt = yield* YtMusic;
      const call: DownloadCall = (method, params) => Effect.runPromise(kotlin.call(method, params));
      const lookups = createLookups(options.fetch);
      const lookUp: typeof lookups.lookUp = (song, has) =>
        lookupsEnabled(db) ? lookups.lookUp(song, has) : Promise.resolve(null);

      const folder = () => {
        const roots = desktopRoots(db, options.platform);
        return (
          preference(db, DOWNLOADS_FOLDER) ??
          roots.find((root) => root.isDefault)?.path ??
          roots[0]?.path ??
          options.musicFolder
        );
      };
      const policy = async () => {
        const target = folder();
        const roots = [
          { path: target, isDefault: true },
          ...desktopRoots(db, options.platform)
            .filter((root) => root.path !== target)
            .map((root) => ({ path: root.path, isDefault: false })),
        ];
        const excluded = excludedFolders(db);
        const revision = await call("downloads.refreshPolicy", {
          roots: roots.map((root) => root.path),
          excluded,
        });
        return { roots, excludedFolders: excluded, revision };
      };

      const { answer } = createAnswers({
        policy,
        ytMusicOn: yt.enabled,
        session: () => call("soulseek.session", {}),
        soulseekSearch: async (query) =>
          (await call("soulseek.search", { query })) as readonly SoulseekCandidate[],
        watchSong: (videoId) => call("download.watchSong", { videoId }),
        album: async (browseId) => (await call("download.album", { browseId })) as YtAlbum,
        ytLyrics: (browseId) => call("download.lyrics", { browseId }),
        ytSearch: async (query) => {
          const found = await yt.search(query);
          if (found.status !== "ok") throw new Error(`YT Music search: ${found.status}`);
          return found.songs;
        },
        lookUp,
        missingSongs: (ids) => selectMissingSongs(db, ids),
        importFile: (path, made) => library.importFile(path, made),
        ...(options.log === undefined ? {} : { log: options.log }),
      });

      const downloads = createDownloads({
        call,
        answer,
        missingSongs: (ids) => selectMissingSongs(db, ids),
        list: (list) => {
          const found = browseRows(db, `${list.kind}s`, [list.id])[0];
          if (found === undefined) return null;
          // An album downloads in album order, the others in their page's order.
          if (list.kind === "album")
            return {
              ids: selectAlbumsMissingSongs(db, [list.id])[0] ?? [],
              origin: albumDownloadOrigin({ id: list.id, title: found.title }),
            };
          return {
            ids: browseTrackIds(db, list).map(Number),
            origin:
              list.kind === "playlist"
                ? playlistDownloadOrigin({ id: list.id, name: found.title })
                : null,
          };
        },
        ytSong: yt.song,
        ytMusicOn: yt.enabled,
        get catalogue() {
          return options.catalogue;
        },
        ...(options.language === undefined ? {} : { language: options.language }),
        favorites: () => new Set(selectFavoriteTrackIds(db)),
        store: {
          read: (key) => preference(db, key) ?? null,
          write: (key, value) => {
            if (value === null) db.run(sql`DELETE FROM desktop_settings WHERE key = ${key}`);
            else savePreference(db, key, value);
          },
        },
      });

      const started = () => {
        void policy()
          .catch(() => null)
          .then(() => downloads.start(options.online()))
          // Stars kept while Wave was closed, or pulled before the journal was up, ask now.
          .then(() => downloads.syncStars())
          .catch((error) => options.log?.("warn", `Downloads didn't start: ${String(error)}`));
      };
      // A restarted JVM says it's ready again; its journal was read back from disk.
      const stopListening = options.events((event) => {
        if (event.event === "downloadsChanged") void downloads.refresh().catch(() => {});
        else if (event.event === "ready") started();
      });
      started();
      const watching = setInterval(() => {
        void downloads.setOnline(options.online()).catch(() => {});
      }, ONLINE_EVERY_MS);

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          clearInterval(watching);
          stopListening();
          downloads.dispose();
        }),
      );

      const runFix = async (
        ids: readonly number[],
        run?: FixSongsRunOptions,
      ): Promise<FixSongsResult> => {
        if (!lookupsEnabled(db)) throw new Error("[lookups-off] Online lookups are off");
        return fixSongs(
          {
            db,
            lookUp,
            writeSong: async (params) =>
              (await Effect.runPromise(kotlin.call("tags.writeSong", params))) as
                TagWriteReport | { readonly failed: unknown },
            reimport: (path) => library.importFile(path),
          },
          ids,
          run,
        );
      };

      return {
        ...downloads,
        folder,
        pickFolder: async () => {
          const picked = await options.pickFolder();
          if (picked === undefined) return null;
          await library.addRoot(picked);
          const path = await library.resolvePath(picked);
          savePreference(db, DOWNLOADS_FOLDER, path);
          await policy().catch(() => null);
          return path;
        },
        fixSongs: (ids) => runFix(ids),
        libraryFix: createLibraryFixRun({
          songs: () =>
            db
              .all<{ id: number }>(sql`SELECT id FROM tracks WHERE path IS NOT NULL ORDER BY id`)
              .map(({ id }) => id),
          fix: runFix,
        }),
      } satisfies DesktopDownloadsShape;
    }),
  );
