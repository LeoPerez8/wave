import type { ImportNotice, LinkImportView, SongLinkNotFound } from "@wave/core";
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
}
export const LINK_CALLS = [
  "links.open",
  "links.importPlaylist",
  "links.copySong",
  "links.copyPlaylist",
] as const;
export const linkBridge = (invoke: Invoke) => ({
  open: (text: string) => invoke("links.open", text),
  importPlaylist: (token: string, replace: boolean) =>
    invoke("links.importPlaylist", token, replace),
  copySong: (target: SongTarget | string) => invoke("links.copySong", target),
  copyPlaylist: (id: number) => invoke("links.copyPlaylist", id),
});

export type OpenLinkResult =
  | { readonly kind: "ignored" }
  | { readonly kind: "playing" }
  | { readonly kind: "notice"; readonly notice: ImportNotice }
  | { readonly kind: "notFound"; readonly song: SongLinkNotFound }
  | { readonly kind: "playlist"; readonly token: string; readonly view: LinkImportView };

export type CopyLinkResult =
  | { readonly kind: "copied"; readonly message: string }
  | { readonly kind: "notice"; readonly notice: ImportNotice };
