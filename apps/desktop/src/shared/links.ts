import type { DesktopShareItem, ImportNotice, LinkImportView, SongLinkNotFound } from "@wave/core";
import type { SongTarget } from "./songActions.ts";
import type { Invoke } from "./bridge.ts";

export interface LinkContract {
  readonly "links.open": {
    readonly args: readonly [text: string];
    readonly result: OpenLinkResult;
  };
  readonly "links.importPlaylist": {
    readonly args: readonly [token: string, replace: boolean];
    readonly result: { readonly playlistId: number; readonly name: string };
  };
  readonly "links.copySong": {
    readonly args: readonly [target: SongTarget | string];
    readonly result: CopyLinkResult;
  };
  readonly "links.copyPlaylist": {
    readonly args: readonly [playlistId: number];
    readonly result: CopyLinkResult;
  };
  /** A song's Share submenu: its card, and its links as main found them. */
  readonly "links.songShare": {
    readonly args: readonly [target: SongTarget | string];
    readonly result: SongShareView;
  };
  /** Copies one of the song addresses Share gives. */
  readonly "links.copyShareLink": {
    readonly args: readonly [url: string];
    readonly result: CopyLinkResult;
  };
}
export const LINK_CALLS = [
  "links.open",
  "links.importPlaylist",
  "links.copySong",
  "links.copyPlaylist",
  "links.songShare",
  "links.copyShareLink",
] as const;
export const linkBridge = (invoke: Invoke) => ({
  open: (text: string) => invoke("links.open", text),
  importPlaylist: (token: string, replace: boolean) =>
    invoke("links.importPlaylist", token, replace),
  copySong: (target: SongTarget | string) => invoke("links.copySong", target),
  copyPlaylist: (id: number) => invoke("links.copyPlaylist", id),
  songShare: (target: SongTarget | string) => invoke("links.songShare", target),
  copyShareLink: (url: string) => invoke("links.copyShareLink", url),
});

export type OpenLinkResult =
  | { readonly kind: "ignored" }
  | { readonly kind: "playing" }
  /** A Spotify album link's album, on its YT Music page (`MPREb_…`). */
  | { readonly kind: "album"; readonly browseId: string }
  | { readonly kind: "notice"; readonly notice: ImportNotice }
  | { readonly kind: "notFound"; readonly song: SongLinkNotFound }
  | { readonly kind: "playlist"; readonly token: string; readonly view: LinkImportView };

export type CopyLinkResult =
  | { readonly kind: "copied"; readonly message: string }
  | { readonly kind: "notice"; readonly notice: ImportNotice };

/** Where a song card's cover comes from: the Library song's, or YouTube's address. */
export type SongShareCover =
  { readonly kind: "song"; readonly id: number } | { readonly kind: "url"; readonly url: string };

/**
 * A song's Share submenu (docs/spec.md, Sharing a song): what its card shows, and the submenu's
 * items in order (Core's `desktopSongShareMenu`).
 */
export interface SongShareView {
  readonly title: string;
  readonly artist: string;
  readonly cover: SongShareCover | null;
  readonly items: readonly DesktopShareItem[];
}
