/**
 * Playlists on main's side: New Playlist, Rename, Delete, Remove from Playlist and its Undo,
 * Move Up and Move Down, the Graveyard, the M3U import and the playlist's own image. The
 * store is the phone's (`@wave/client/db/playlists`), so every edit syncs as the phone's do;
 * the image stays on this computer, as it stays on the phone.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { Database } from "@wave/client";
import type { LibraryDatabase } from "@wave/client/db/database";
import {
  createPlaylist,
  deletePlaylist,
  forgetGraveyardItems,
  movePlaylistItem,
  movePlaylistItems,
  removePlaylistItems,
  renamePlaylist,
  replacePlaylistSongs,
  restoreGraveyardItem,
  restorePlaylistItems,
  selectPlaylistEntries,
  selectPlaylistGraveyard,
  selectTrackPaths,
  type PlaylistRemoval,
} from "@wave/client/db/playlists";
import { playlistSongSort } from "./browseSort.ts";
import {
  movePlaylistInList,
  playlistListView,
  showPlaylistListAs,
  sortPlaylistList,
} from "./playlistList.ts";
import {
  removePlaylistImage,
  selectPlaylistImageOriginal,
  setPlaylistImage,
  takeDeletedPlaylistImages,
} from "@wave/client/db/playlistImages";
import {
  CENTRE_FRAMING,
  checkPlaylistName,
  framingSquare,
  framingText,
  importNameClash,
  isM3uFileName,
  keepBothName,
  libraryPathIndex,
  nextPlaylistName,
  planM3uImport,
  playlistReorders,
  readFraming,
  resolveDesktopM3uPath,
  toPlaylistSongs,
  type AppLanguage,
  type FramingSquare,
  type ImageFraming,
  type ImageSize,
  type M3uImport,
  type M3uImportOutcome,
  type PlaylistLayout,
  type PlaylistNameCheck,
  type PlaylistSort,
  type QueueState,
  type YtAlbumSong,
} from "@wave/core";
import { sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Page } from "../../shared/bridge.ts";
import type { SongTarget } from "../../shared/songActions.ts";
import type {
  GraveyardRow,
  ImageEdit,
  ImportAnswer,
  ImportChoice,
  ImportResult,
  MoveDirection,
  PlaylistInfo,
  PlaylistCreateTarget,
} from "../../shared/playlists.ts";
import type { PlayStart } from "../../shared/playerView.ts";
import { ytRow } from "../../shared/yt.ts";
import { Playback } from "../playback/playback.ts";
import { YtMusic } from "../yt/ytMusic.ts";
import { browseSongs, type PlaylistSong } from "./browse.ts";
import { isCollaborative, refuseCollaborative } from "./collaborativePlaylists.ts";
import { targetEntries, targetPlaylistEntries } from "./songActions.ts";
import { collectionSongs } from "./collectionActions.ts";

/** Reads and cuts photos for a playlist's image (Electron's `nativeImage` in the app). */
export interface PlaylistImageCodec {
  /** A picked photo as the JPEG kept for Adjust Image, and its size; undefined if it isn't one. */
  readonly original: (
    bytes: Uint8Array,
  ) => { readonly jpeg: Uint8Array; readonly width: number; readonly height: number } | undefined;
  /** [square] of [jpeg] as a JPEG at each of [sides] px (no larger than the square). */
  readonly squares: (
    jpeg: Uint8Array,
    square: FramingSquare,
    sides: readonly number[],
  ) => Uint8Array[];
}

export interface PlaylistOptions {
  readonly db: LibraryDatabase;
  /** `process.platform`: how an imported playlist's paths read. */
  readonly platform: string;
  /** Where playlist images are kept; nothing outside it is read or deleted. */
  readonly imageFolder: string;
  readonly codec: PlaylistImageCodec;
  /** The system picker for one photo; undefined when cancelled. */
  readonly pickImage: () => Promise<string | undefined>;
  /** The system picker for M3U files; none when cancelled. */
  readonly pickPlaylists: () => Promise<readonly string[]>;
  /** Tells the window, and sync, that playlists changed. */
  readonly changed: () => void;
  readonly now?: () => number;
  /** Remembers the streamed songs a Graveyard page shows, so their menus and plays find them. */
  readonly keepStreams?: (songs: readonly YtAlbumSong[]) => void;
  /** Plays [songs] as a new queue from [index] (`Playback.playEntries`). */
  readonly play?: (
    songs: readonly PlaylistSong[],
    index: number,
    context: NonNullable<QueueState["context"]>,
  ) => Promise<PlayStart>;
}

/** The image sizes saved: the playlist's page, and lists. */
const IMAGE_SIDES = [1200, 300] as const;
/** A playlist file larger than this isn't read. */
const MAX_PLAYLIST_FILE = 10 * 1024 * 1024;

const JPEG_URL = "data:image/jpeg;base64,";

/** A picked file as the import will treat it. */
type PendingFile =
  | { readonly outcome: Exclude<M3uImportOutcome, { readonly kind: "imported" }> }
  | {
      readonly file: string;
      readonly plan: M3uImport<number>;
      /** The playlist that had the name when the files were picked. */
      readonly clashId: number | undefined;
    };

interface PendingImage {
  readonly playlistId: number;
  readonly jpeg: Uint8Array;
  readonly size: ImageSize;
  /** The original kept from before (Adjust Image); a new photo has none yet. */
  readonly originalPath: string | undefined;
}

/** A playlist file's text: UTF-8, else Latin-1 (older players write it), without a BOM. */
const decodePlaylist = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return Buffer.from(bytes).toString("latin1").replace(/^﻿/, "");
  }
};

export const createPlaylists = (options: PlaylistOptions) => {
  const { db, codec, imageFolder, changed } = options;
  const now = options.now ?? Date.now;
  let lastRemoval: PlaylistRemoval | undefined;
  let pendingImport: readonly PendingFile[] | undefined;
  let pendingImage: PendingImage | undefined;

  const inFolder = (path: string): boolean => {
    const inside = relative(resolve(imageFolder), resolve(path));
    return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
  };
  /** Deletes image files nothing shows any more; only Wave's own. */
  const deleteImages = (paths: readonly string[]): void => {
    for (const path of paths) if (inFolder(path)) rmSync(path, { force: true });
  };
  const livePlaylists = () =>
    db.all<{ id: number; name: string }>(sql`SELECT id, name FROM playlists WHERE deleted=0`);
  const libraryEntries = (playlistId: number) =>
    selectPlaylistEntries(db, playlistId).flatMap((entry) =>
      entry.source === "library" ? [{ itemId: entry.itemId, trackId: entry.track.id }] : [],
    );
  /** The Graveyard's Library and streamed songs, newest removal first. */
  const libraryGraveyard = (playlistId: number) =>
    selectPlaylistGraveyard(db, playlistId).flatMap(
      (entry): (PlaylistSong & { readonly itemId: number; readonly removedAt: number })[] =>
        entry.source === "library"
          ? [{ itemId: entry.itemId, trackId: entry.track.id, removedAt: entry.removedAt }]
          : entry.source === "stream"
            ? [{ itemId: entry.itemId, song: entry.song, removedAt: entry.removedAt }]
            : [],
    );
  const songsOf = (trackIds: readonly number[]) =>
    trackIds.map((trackId) => ({ source: "library" as const, trackId }));

  /** What Change Image and Adjust Image show: the photo and where it's framed. */
  const editOf = (image: PendingImage, framing: ImageFraming): ImageEdit => ({
    photo: JPEG_URL + Buffer.from(image.jpeg).toString("base64"),
    width: image.size.width,
    height: image.size.height,
    framing,
  });

  // The images of playlists deleted elsewhere since the last run.
  deleteImages(takeDeletedPlaylistImages(db));

  return {
    checkName: (name: string, playlistId?: number): PlaylistNameCheck =>
      checkPlaylistName(
        name,
        livePlaylists()
          .filter((playlist) => playlist.id !== playlistId)
          .map((playlist) => playlist.name),
      ),
    newName: (language: AppLanguage): string =>
      nextPlaylistName(
        livePlaylists().map((playlist) => playlist.name),
        language,
      ),
    create: (name: string, target?: PlaylistCreateTarget) => {
      const songs =
        target === undefined
          ? []
          : "scope" in target
            ? targetPlaylistEntries(db, target)
            : toPlaylistSongs(collectionSongs(db, target));
      const made = createPlaylist(db, name, songs, now());
      changed();
      return { id: made.playlistId, name: made.name, added: made.added };
    },
    rename: (playlistId: number, name: string): void => {
      refuseCollaborative(db, playlistId);
      renamePlaylist(db, playlistId, name, now());
      changed();
    },
    delete: (playlistId: number): void => {
      refuseCollaborative(db, playlistId);
      deletePlaylist(db, playlistId, now());
      deleteImages(takeDeletedPlaylistImages(db));
      changed();
    },
    info: (playlistId: number): PlaylistInfo | null => {
      const row = db.get<{ name: string; hasImage: number }>(
        sql`SELECT name, image_path IS NOT NULL AS hasImage FROM playlists WHERE id=${playlistId} AND deleted=0`,
      );
      return row === undefined
        ? null
        : {
            name: row.name,
            hasImage: row.hasImage === 1,
            graveyard: libraryGraveyard(playlistId).length,
            collaborative: isCollaborative(db, playlistId),
          };
    },
    /** Remove from Playlist: Library song IDs and negated streamed entry IDs. */
    removeSongs: (playlistId: number, rowIds: readonly number[]): number => {
      refuseCollaborative(db, playlistId);
      const named = new Set(rowIds);
      const items = selectPlaylistEntries(db, playlistId).flatMap((entry) => {
        if (entry.source === "unavailable") return [];
        const key = entry.source === "library" ? entry.track.id : -entry.itemId;
        return named.has(key) ? [entry.itemId] : [];
      });
      const removal = removePlaylistItems(db, playlistId, items, now());
      lastRemoval = removal;
      if (removal.entries.length > 0) changed();
      return removal.entries.length;
    },
    undoRemove: (): void => {
      const removal = lastRemoval;
      lastRemoval = undefined;
      // It became collaborative since: it stays as the others have it.
      if (removal === undefined || isCollaborative(db, removal.playlistId)) return;
      restorePlaylistItems(db, removal, now());
      changed();
    },
    move: (playlistId: number, trackId: number, direction: MoveDirection): void => {
      refuseCollaborative(db, playlistId);
      // Only the playlist's own order moves; a sorted page offers no Move Up or Move Down.
      if (!playlistReorders(playlistSongSort(db, playlistId))) return;
      const shown = libraryEntries(playlistId);
      const at = shown.findIndex((entry) => entry.trackId === trackId);
      const neighbour = shown[direction === "up" ? at - 1 : at + 1];
      if (at === -1 || neighbour === undefined) return;
      const moved = shown[at]!.itemId;
      // Its place among every entry, streamed songs the page doesn't show included.
      const others = selectPlaylistEntries(db, playlistId).filter(
        (entry) => entry.itemId !== moved,
      );
      const index = others.findIndex((entry) => entry.itemId === neighbour.itemId);
      movePlaylistItem(db, playlistId, moved, direction === "up" ? index : index + 1, now());
      changed();
    },
    /**
     * A drag on the playlist's page: [target]'s songs, together and in the playlist's order,
     * go before row [before] (a Library song ID or a negated streamed entry ID), or after the
     * last entry when it is null. A drop on one of the dragged rows lands before the next row.
     */
    place: (playlistId: number, target: SongTarget, before: number | null): void => {
      refuseCollaborative(db, playlistId);
      if (!playlistReorders(playlistSongSort(db, playlistId))) return;
      if (target.scope.kind !== "playlist" || target.scope.id !== playlistId) return;
      const named = new Set(
        targetEntries(db, target).map((song) => ("trackId" in song ? song.trackId : -song.itemId)),
      );
      const entries = selectPlaylistEntries(db, playlistId);
      const keyOf = (entry: (typeof entries)[number]) =>
        entry.source === "library"
          ? entry.track.id
          : entry.source === "unavailable"
            ? undefined
            : -entry.itemId;
      const moved = entries.flatMap((entry) => {
        const key = keyOf(entry);
        return key !== undefined && named.has(key) ? [entry.itemId] : [];
      });
      if (moved.length === 0) return;
      const taken = new Set(moved);
      const anchor = entries.findIndex((entry) => keyOf(entry) === before);
      const next =
        before === null || anchor === -1
          ? undefined
          : entries.slice(anchor).find((entry) => !taken.has(entry.itemId));
      movePlaylistItems(db, playlistId, moved, next?.itemId ?? null, now());
      changed();
    },
    graveyard: (playlistId: number, offset: number, limit: number): Page<GraveyardRow> => {
      const all = libraryGraveyard(playlistId);
      const entries = all.slice(offset, offset + limit);
      const rows = new Map(
        browseSongs(
          db,
          entries.flatMap((entry) => ("trackId" in entry ? [entry.trackId] : [])),
        ).map((row) => [row.id, row]),
      );
      options.keepStreams?.(entries.flatMap((entry) => ("song" in entry ? [entry.song] : [])));
      return {
        items: entries.flatMap((entry) => {
          // A streamed song's row goes by its entry, negated, as on the playlist's page.
          const row =
            "trackId" in entry
              ? rows.get(entry.trackId)
              : { ...ytRow(entry.song), id: -entry.itemId };
          return row === undefined
            ? []
            : [{ ...row, itemId: entry.itemId, removedAt: entry.removedAt }];
        }),
        offset,
        total: all.length,
      };
    },
    /** Plays the Graveyard's songs from [itemId]'s, leaving them all in the Graveyard. */
    playGraveyard: async (playlistId: number, itemId: number): Promise<PlayStart> => {
      const all = libraryGraveyard(playlistId);
      const index = all.findIndex((entry) => entry.itemId === itemId);
      if (index === -1) throw new Error("That song isn't in the Graveyard");
      if (options.play === undefined) throw new Error("Nothing plays here");
      const songs = all.map((entry): PlaylistSong =>
        "trackId" in entry
          ? { trackId: entry.trackId }
          : { itemId: entry.itemId, song: entry.song },
      );
      return options.play(songs, index, { kind: "playlist", id: String(playlistId) });
    },
    restore: (playlistId: number, itemId: number): void => {
      refuseCollaborative(db, playlistId);
      restoreGraveyardItem(db, playlistId, itemId, now());
      changed();
    },
    forget: (playlistId: number, itemId?: number): void => {
      refuseCollaborative(db, playlistId);
      forgetGraveyardItems(db, playlistId, itemId, now());
      changed();
    },
    chooseImport: async (): Promise<ImportChoice | null> => {
      pendingImport = undefined;
      const paths = await options.pickPlaylists();
      if (paths.length === 0) return null;
      const library = libraryPathIndex(selectTrackPaths(db));
      const playlists = livePlaylists();
      // A collaborative playlist is never replaced: a file named as it makes a playlist of its own.
      const replaceable = playlists.filter((playlist) => !isCollaborative(db, playlist.id));
      const files = paths.map((path): PendingFile => {
        const file = basename(path);
        if (!isM3uFileName(file)) return { outcome: { kind: "notPlaylist", file } };
        let text: string;
        try {
          if (statSync(path).size > MAX_PLAYLIST_FILE) throw new Error("Too large");
          text = decodePlaylist(readFileSync(path));
        } catch {
          return { outcome: { kind: "unreadable", file } };
        }
        const plan = planM3uImport({ name: file, path, text }, library, (location, from) =>
          resolveDesktopM3uPath(location, from, options.platform),
        );
        if (plan.trackIds.length === 0)
          return { outcome: { kind: "nothingFound", file, missing: plan.missing } };
        return { file, plan, clashId: importNameClash(plan.name, replaceable)?.id };
      });
      pendingImport = files;
      return {
        files: files.map((pending) => ({
          name: "outcome" in pending ? pending.outcome.file : pending.file,
          clash:
            "outcome" in pending || pending.clashId === undefined
              ? null
              : (playlists.find((playlist) => playlist.id === pending.clashId)?.name ?? null),
        })),
      };
    },
    /**
     * Imports the files picked last, one at a time as the phone does: [answers] says, for a
     * file whose name a playlist had, whether it replaces that playlist's songs.
     */
    runImport: (answers: readonly ImportAnswer[]): ImportResult => {
      const files = pendingImport;
      pendingImport = undefined;
      if (files === undefined) throw new Error("Nothing to import");
      let playlistId: number | null = null;
      const outcomes = files.map((pending, i): M3uImportOutcome => {
        if ("outcome" in pending) return pending.outcome;
        const { plan, clashId } = pending;
        const songs = songsOf(plan.trackIds);
        const playlists = livePlaylists();
        const clash = playlists.find((playlist) => playlist.id === clashId);
        if (clash !== undefined && answers[i] === "replace" && !isCollaborative(db, clash.id)) {
          replacePlaylistSongs(db, clash.id, songs, now());
          playlistId = clash.id;
          return { ...imported(plan), name: clash.name, replaced: true };
        }
        const names = playlists.map((playlist) => playlist.name);
        const name =
          importNameClash(plan.name, playlists) === undefined
            ? plan.name
            : keepBothName(plan.name, names);
        const made = createPlaylist(db, name, songs, now());
        playlistId = made.playlistId;
        return { ...imported(plan), name: made.name, replaced: false };
      });
      if (playlistId !== null) changed();
      return { outcomes, playlistId };
    },
    pickImage: async (playlistId: number): Promise<ImageEdit | null> => {
      pendingImage = undefined;
      const path = await options.pickImage();
      if (path === undefined) return null;
      const photo = codec.original(await readFile(path));
      if (photo === undefined) throw new Error("The file isn't an image");
      pendingImage = {
        playlistId,
        jpeg: photo.jpeg,
        size: { width: photo.width, height: photo.height },
        originalPath: undefined,
      };
      return editOf(pendingImage, CENTRE_FRAMING);
    },
    adjustImage: async (playlistId: number): Promise<ImageEdit | null> => {
      pendingImage = undefined;
      const kept = selectPlaylistImageOriginal(db, playlistId);
      if (kept === null || !inFolder(kept.originalPath)) return null;
      const photo = codec.original(await readFile(kept.originalPath));
      if (photo === undefined) return null;
      const size = { width: photo.width, height: photo.height };
      const last = readFraming(kept.framing);
      pendingImage = { playlistId, jpeg: photo.jpeg, size, originalPath: kept.originalPath };
      return editOf(
        pendingImage,
        last !== null && last.size.width === size.width && last.size.height === size.height
          ? last.framing
          : CENTRE_FRAMING,
      );
    },
    saveImage: (playlistId: number, framing: ImageFraming): void => {
      const image = pendingImage;
      if (image === undefined || image.playlistId !== playlistId)
        throw new Error("No photo to save");
      pendingImage = undefined;
      const [large, thumb] = codec.squares(
        image.jpeg,
        framingSquare(image.size, framing),
        IMAGE_SIDES,
      );
      if (large === undefined || thumb === undefined) throw new Error("The photo couldn't be cut");
      mkdirSync(imageFolder, { recursive: true });
      const stem = join(imageFolder, `${playlistId}-${randomUUID()}`);
      const files = {
        path: `${stem}.jpg`,
        thumbPath: `${stem}-thumb.jpg`,
        originalPath: image.originalPath ?? `${stem}-original.jpg`,
        framing: framingText(image.size, framing),
      };
      writeFileSync(files.path, large);
      writeFileSync(files.thumbPath, thumb);
      if (image.originalPath === undefined) writeFileSync(files.originalPath, image.jpeg);
      deleteImages(setPlaylistImage(db, playlistId, files));
    },
    cancelImage: (): void => {
      pendingImage = undefined;
    },
    removeImage: (playlistId: number): void => {
      deleteImages(removePlaylistImage(db, playlistId));
    },
    image: async (playlistId: number, large: boolean): Promise<string | null> => {
      const row = db.get<{ path: string | null }>(
        large
          ? sql`SELECT image_path AS path FROM playlists WHERE id=${playlistId} AND deleted=0`
          : sql`SELECT image_thumb_path AS path FROM playlists WHERE id=${playlistId} AND deleted=0`,
      );
      if (row?.path == null || !inFolder(row.path)) return null;
      try {
        return JPEG_URL + (await readFile(row.path)).toString("base64");
      } catch {
        return null;
      }
    },
    listView: () => playlistListView(db),
    sortList: (sort: PlaylistSort): void => {
      sortPlaylistList(db, sort);
      changed();
    },
    showListAs: (layout: PlaylistLayout): void => {
      showPlaylistListAs(db, layout);
      changed();
    },
    moveInList: (playlistId: number, to: number): boolean => {
      const moved = movePlaylistInList(db, playlistId, to);
      if (moved) changed();
      return moved;
    },
  };
};

const imported = (plan: M3uImport<number>) => ({
  kind: "imported" as const,
  songs: plan.trackIds.length,
  missing: plan.missing,
});

export type PlaylistsShape = ReturnType<typeof createPlaylists>;

export class DesktopPlaylists extends Context.Service<DesktopPlaylists, PlaylistsShape>()(
  "@wave/desktop/DesktopPlaylists",
) {}

/** The playlists over the Library; each edit refreshes the window and pushes to sync. */
export const desktopPlaylistsLayer = (options: Omit<PlaylistOptions, "db" | "changed" | "now">) =>
  Layer.effect(
    DesktopPlaylists,
    Effect.gen(function* () {
      const db = yield* Database;
      const playback = yield* Playback;
      const yt = yield* YtMusic;
      return createPlaylists({
        ...options,
        db,
        changed: () => playback.refresh(),
        keepStreams: yt.keep,
        play: playback.playEntries,
      });
    }),
  );
