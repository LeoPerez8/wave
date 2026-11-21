/**
 * Playlists as the window edits them (`window.wave.playlists`): New Playlist, Rename, Delete,
 * the playlist's image, Move Up and Move Down, Undo of a removal, the Graveyard and the M3U
 * import. Main does the work; the window asks and shows.
 */
import type {
  ImageFraming,
  M3uImportOutcome,
  PlaylistLayout,
  PlaylistNameCheck,
  PlaylistSort,
} from "@wave/core";
import type { BridgeContract, Invoke, Page } from "./bridge.ts";
import type { BrowseRow } from "./browse.ts";
import type { SongTarget } from "./songActions.ts";
import type { CollectionTarget } from "./collectionActions.ts";
import type { PlayStart } from "./playerView.ts";

export type PlaylistCreateTarget = SongTarget | CollectionTarget;

/** What a playlist's menu needs to know. */
export interface PlaylistInfo {
  readonly name: string;
  /** It shows an image of its own instead of its first song's cover. */
  readonly hasImage: boolean;
  /** Songs in its Graveyard. */
  readonly graveyard: number;
  /** Several Wave accounts edit it: the desktop offers none of its edits, only its image. */
  readonly collaborative: boolean;
}

/** A song removed from a playlist by hand, as its Graveyard lists it. */
export interface GraveyardRow extends BrowseRow {
  /** The playlist entry, which Restore and Remove from Graveyard name. */
  readonly itemId: number;
  readonly removedAt: number;
}

/** The files an import picked: their names, and the playlist each one's name clashes with. */
export interface ImportChoice {
  readonly files: readonly { readonly name: string; readonly clash: string | null }[];
}

/** What to do with a file whose name another playlist has. */
export type ImportAnswer = "replace" | "keepBoth";

export interface ImportResult {
  readonly outcomes: readonly M3uImportOutcome[];
  /** The playlist the import made or filled last, to open; null when it made none. */
  readonly playlistId: number | null;
}

/** A photo to frame for a playlist's image (Change Image, Adjust Image). */
export interface ImageEdit {
  /** The photo, as a data URL. */
  readonly photo: string;
  readonly width: number;
  readonly height: number;
  readonly framing: ImageFraming;
}

export type MoveDirection = "up" | "down";

/** How the Playlists list shows and orders playlists (the page and the sidebar alike). */
export interface PlaylistListView {
  readonly sort: PlaylistSort;
  /** The page's table (`list`) or its grid of covers. */
  readonly layout: PlaylistLayout;
  /** Every playlist's id, in the order the list shows them. */
  readonly ids: readonly number[];
}

export interface PlaylistContract {
  /** Whether [name] can name a playlist (the one named [playlistId] keeps its own). */
  readonly "playlists.checkName": {
    readonly args: readonly [name: string, playlistId?: number];
    readonly result: PlaylistNameCheck;
  };
  /** New Playlist's suggestion: New Playlist, then New Playlist 2, 3… */
  readonly "playlists.newName": {
    readonly args: readonly [];
    readonly result: string;
  };
  /** Makes a playlist, holding [target]'s songs when given; its id. */
  readonly "playlists.create": {
    readonly args: readonly [name: string, target?: PlaylistCreateTarget];
    readonly result: { readonly id: number; readonly name: string; readonly added: number };
  };
  readonly "playlists.rename": {
    readonly args: readonly [playlistId: number, name: string];
    readonly result: void;
  };
  readonly "playlists.delete": {
    readonly args: readonly [playlistId: number];
    readonly result: void;
  };
  readonly "playlists.info": {
    readonly args: readonly [playlistId: number];
    readonly result: PlaylistInfo | null;
  };
  /** Puts back the songs the last Remove from Playlist took out. */
  readonly "playlists.undoRemove": { readonly args: readonly []; readonly result: void };
  /** Moves a playlist's song one place up or down among the songs its page shows. */
  readonly "playlists.move": {
    readonly args: readonly [playlistId: number, trackId: number, direction: MoveDirection];
    readonly result: void;
  };
  readonly "playlists.graveyard": {
    readonly args: readonly [playlistId: number, offset: number, limit: number];
    readonly result: Page<GraveyardRow>;
  };
  readonly "playlists.restore": {
    readonly args: readonly [playlistId: number, itemId: number];
    readonly result: void;
  };
  /** Plays the Graveyard's songs from [itemId]'s; none of them is restored. */
  readonly "playlists.playGraveyard": {
    readonly args: readonly [playlistId: number, itemId: number];
    readonly result: PlayStart;
  };
  /** Remove from Graveyard for one song, or Empty Graveyard without [itemId]. */
  readonly "playlists.forget": {
    readonly args: readonly [playlistId: number, itemId?: number];
    readonly result: void;
  };
  /** Opens the file picker for M3U playlists; null when nothing was picked. */
  readonly "playlists.chooseImport": {
    readonly args: readonly [];
    readonly result: ImportChoice | null;
  };
  /** Imports the files picked last, with an answer for each file. */
  readonly "playlists.runImport": {
    readonly args: readonly [answers: readonly ImportAnswer[]];
    readonly result: ImportResult;
  };
  /** Change Image: opens the picker for a photo; null when none was picked. */
  readonly "playlists.pickImage": {
    readonly args: readonly [playlistId: number];
    readonly result: ImageEdit | null;
  };
  /** Adjust Image: the original photo, at its last framing. */
  readonly "playlists.adjustImage": {
    readonly args: readonly [playlistId: number];
    readonly result: ImageEdit | null;
  };
  /** Saves the photo picked or adjusted last, at [framing], as the playlist's image. */
  readonly "playlists.saveImage": {
    readonly args: readonly [playlistId: number, framing: ImageFraming];
    readonly result: void;
  };
  readonly "playlists.cancelImage": { readonly args: readonly []; readonly result: void };
  readonly "playlists.removeImage": {
    readonly args: readonly [playlistId: number];
    readonly result: void;
  };
  /** The playlist's image as a data URL, or null. */
  readonly "playlists.image": {
    readonly args: readonly [playlistId: number, large: boolean];
    readonly result: string | null;
  };
  /**
   * A drag on a playlist's page in its own order: [target]'s songs, together, go before row
   * [before] (a row's ID), or to the end when it is null.
   */
  readonly "playlists.place": {
    readonly args: readonly [playlistId: number, target: SongTarget, before: number | null];
    readonly result: void;
  };
  readonly "playlists.listView": { readonly args: readonly []; readonly result: PlaylistListView };
  /** Sorts the Playlists list; Custom brings back the order arranged before. */
  readonly "playlists.sortList": {
    readonly args: readonly [sort: PlaylistSort];
    readonly result: void;
  };
  readonly "playlists.showListAs": {
    readonly args: readonly [layout: PlaylistLayout];
    readonly result: void;
  };
  /** In Custom, moves a playlist to place [to] (from 0) of the list; false when nothing moved. */
  readonly "playlists.moveInList": {
    readonly args: readonly [playlistId: number, to: number];
    readonly result: boolean;
  };
}

export const PLAYLIST_CALLS = [
  "playlists.checkName",
  "playlists.newName",
  "playlists.create",
  "playlists.rename",
  "playlists.delete",
  "playlists.info",
  "playlists.undoRemove",
  "playlists.move",
  "playlists.graveyard",
  "playlists.restore",
  "playlists.forget",
  "playlists.chooseImport",
  "playlists.runImport",
  "playlists.pickImage",
  "playlists.adjustImage",
  "playlists.saveImage",
  "playlists.cancelImage",
  "playlists.removeImage",
  "playlists.image",
  "playlists.place",
  "playlists.listView",
  "playlists.sortList",
  "playlists.showListAs",
  "playlists.moveInList",
  "playlists.playGraveyard",
] as const satisfies readonly (keyof PlaylistContract)[];

type Call<C extends keyof PlaylistContract> = (
  ...args: BridgeContract[C]["args"]
) => Promise<BridgeContract[C]["result"]>;

/** `window.wave.playlists`. */
export interface PlaylistBridge {
  readonly checkName: Call<"playlists.checkName">;
  readonly newName: Call<"playlists.newName">;
  readonly create: Call<"playlists.create">;
  readonly rename: Call<"playlists.rename">;
  readonly delete: Call<"playlists.delete">;
  readonly info: Call<"playlists.info">;
  readonly undoRemove: Call<"playlists.undoRemove">;
  readonly move: Call<"playlists.move">;
  readonly graveyard: Call<"playlists.graveyard">;
  readonly restore: Call<"playlists.restore">;
  readonly forget: Call<"playlists.forget">;
  readonly chooseImport: Call<"playlists.chooseImport">;
  readonly runImport: Call<"playlists.runImport">;
  readonly pickImage: Call<"playlists.pickImage">;
  readonly adjustImage: Call<"playlists.adjustImage">;
  readonly saveImage: Call<"playlists.saveImage">;
  readonly cancelImage: Call<"playlists.cancelImage">;
  readonly removeImage: Call<"playlists.removeImage">;
  readonly image: Call<"playlists.image">;
  readonly place: Call<"playlists.place">;
  readonly listView: Call<"playlists.listView">;
  readonly sortList: Call<"playlists.sortList">;
  readonly showListAs: Call<"playlists.showListAs">;
  readonly moveInList: Call<"playlists.moveInList">;
  readonly playGraveyard: Call<"playlists.playGraveyard">;
}

export const playlistBridge = (invoke: Invoke): PlaylistBridge => ({
  checkName: (name, playlistId) => invoke("playlists.checkName", name, playlistId),
  newName: () => invoke("playlists.newName"),
  create: (name, target) => invoke("playlists.create", name, target),
  rename: (playlistId, name) => invoke("playlists.rename", playlistId, name),
  delete: (playlistId) => invoke("playlists.delete", playlistId),
  info: (playlistId) => invoke("playlists.info", playlistId),
  undoRemove: () => invoke("playlists.undoRemove"),
  move: (playlistId, trackId, direction) =>
    invoke("playlists.move", playlistId, trackId, direction),
  graveyard: (playlistId, offset, limit) =>
    invoke("playlists.graveyard", playlistId, offset, limit),
  restore: (playlistId, itemId) => invoke("playlists.restore", playlistId, itemId),
  forget: (playlistId, itemId) => invoke("playlists.forget", playlistId, itemId),
  chooseImport: () => invoke("playlists.chooseImport"),
  runImport: (answers) => invoke("playlists.runImport", answers),
  pickImage: (playlistId) => invoke("playlists.pickImage", playlistId),
  adjustImage: (playlistId) => invoke("playlists.adjustImage", playlistId),
  saveImage: (playlistId, framing) => invoke("playlists.saveImage", playlistId, framing),
  cancelImage: () => invoke("playlists.cancelImage"),
  removeImage: (playlistId) => invoke("playlists.removeImage", playlistId),
  image: (playlistId, large) => invoke("playlists.image", playlistId, large),
  place: (playlistId, target, before) => invoke("playlists.place", playlistId, target, before),
  listView: () => invoke("playlists.listView"),
  sortList: (sort) => invoke("playlists.sortList", sort),
  showListAs: (layout) => invoke("playlists.showListAs", layout),
  moveInList: (playlistId, to) => invoke("playlists.moveInList", playlistId, to),
  playGraveyard: (playlistId, itemId) => invoke("playlists.playGraveyard", playlistId, itemId),
});
