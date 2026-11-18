import type { ImportNotice, LinkImportView, SongLinkNotFound } from "@wave/core";
import type { AppLanguage } from "@wave/core";
import type { SongTarget } from "./songActions.ts";
import type { Invoke } from "./bridge.ts";

export interface LinkContract {
  readonly "links.open": {
    readonly args: readonly [text: string, language: AppLanguage];
    readonly result: OpenLinkResult;
  };
  readonly "links.importPlaylist": {
    readonly args: readonly [token: string, replace: boolean];
    readonly result: { readonly playlistId: number; readonly name: string };
  };
  readonly "links.copySong": {
    readonly args: readonly [target: SongTarget | string, language: AppLanguage];
    readonly result: CopyLinkResult;
  };
  readonly "links.copyPlaylist": {
    readonly args: readonly [playlistId: number, language: AppLanguage];
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
  open: (text: string, language: AppLanguage) => invoke("links.open", text, language),
  importPlaylist: (token: string, replace: boolean) =>
    invoke("links.importPlaylist", token, replace),
  copySong: (target: SongTarget | string, language: AppLanguage) =>
    invoke("links.copySong", target, language),
  copyPlaylist: (id: number, language: AppLanguage) => invoke("links.copyPlaylist", id, language),
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
