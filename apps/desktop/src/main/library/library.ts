import { Database } from "@wave/client";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Kotlin } from "../kotlin/kotlin.ts";
import { createScanner } from "./scanner.ts";
import { browseLibrary } from "./browse.ts";
import type { BrowseScope } from "../../shared/browse.ts";
import { preference, savePreference } from "../preferences.ts";
import type { ArtworkKind } from "./onlineArtwork.ts";
import { missingSongCover } from "@wave/client/artworkLookup";
import type { YtAlbum } from "@wave/core";
import { YtMusic } from "../yt/ytMusic.ts";

export interface DesktopLibraryShape extends ReturnType<typeof createScanner> {
  readonly cover?: (kind: ArtworkKind, id: number, large: boolean) => Promise<string | null>;
  readonly browse: (
    scope: BrowseScope,
    offset: number,
    limit: number,
  ) => ReturnType<typeof browseLibrary>;
  readonly pickRoot: () => Promise<void>;
  readonly pickExclusion: () => Promise<void>;
}

export class DesktopLibrary extends Context.Service<DesktopLibrary, DesktopLibraryShape>()(
  "@wave/desktop/DesktopLibrary",
) {}

export const desktopLibraryLayer = (options: {
  readonly musicFolder: string;
  readonly platform: string;
  readonly pickFolder: () => Promise<string | undefined>;
  readonly cacheArtwork?: (db: Database["Service"], encoded: string) => Promise<string | null>;
  readonly onlineArtwork?: (
    db: Database["Service"],
    ytMusic: {
      readonly on: () => boolean;
      /** The cover of a video's album on YouTube Music, as a phone download takes it. */
      readonly videoCover: (videoId: string) => Promise<string | null>;
    },
  ) => (kind: ArtworkKind, id: number, large: boolean) => Promise<string | null>;
}) =>
  Layer.effect(
    DesktopLibrary,
    Effect.gen(function* () {
      const db = yield* Database;
      const kotlin = yield* Kotlin;
      const yt = yield* YtMusic;
      const ytMusic = {
        on: yt.enabled,
        videoCover: (videoId: string) =>
          missingSongCover(
            { videoId, artworkUrl: null },
            (id) => Effect.runPromise(kotlin.call("download.watchSong", { videoId: id })),
            async (browseId) =>
              (await Effect.runPromise(kotlin.call("download.album", { browseId }))) as YtAlbum,
          ),
      };
      return yield* Effect.acquireRelease(
        Effect.sync(() => {
          const scanner = createScanner({
            ...options,
            db,
            readTags: (path) => Effect.runPromise(kotlin.readTags(path)),
            cacheArtwork: options.cacheArtwork
              ? (encoded) => options.cacheArtwork!(db, encoded)
              : undefined,
            forceTags:
              options.cacheArtwork !== undefined && preference(db, "artworkVersion") !== "1",
            tagsUpdated: options.cacheArtwork
              ? () => savePreference(db, "artworkVersion", "1")
              : undefined,
          });
          void scanner.refresh();
          return {
            ...scanner,
            cover: options.onlineArtwork?.(db, ytMusic),
            browse: (scope: BrowseScope, offset: number, limit: number) => {
              const page = browseLibrary(db, scope, offset, limit);
              return {
                ...page,
                items: page.items.map((row) => ({
                  ...row,
                  unavailable: row.path !== null && scanner.unavailable(row.path),
                })),
              };
            },
            pickRoot: async () => {
              const path = await options.pickFolder();
              if (path !== undefined) await scanner.addRoot(path);
            },
            pickExclusion: async () => {
              const path = await options.pickFolder();
              if (path !== undefined) await scanner.exclude(path);
            },
          };
        }),
        (library) => Effect.promise(() => library.dispose()),
      );
    }),
  );
