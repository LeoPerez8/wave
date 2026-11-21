/** Main's side of `window.wave.playlists`: each call's arguments come from the window, checked here. */
import {
  DESKTOP_PLAYLIST_LAYOUTS,
  PLAYLIST_SORTS,
  type ImageFraming,
  type PlaylistLayout,
  type PlaylistSort,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { BridgeContract } from "../shared/bridge.ts";
import type { ImportAnswer, PLAYLIST_CALLS } from "../shared/playlists.ts";
import type { SongTarget } from "../shared/songActions.ts";
import { Account } from "./account/accountLayer.ts";
import { DesktopPlaylists, type PlaylistsShape } from "./library/playlists.ts";
import { validCollectionTarget } from "./library/collectionActions.ts";

type PlaylistCall = (typeof PLAYLIST_CALLS)[number];

export type PlaylistHandlers = {
  readonly [C in PlaylistCall]: (
    args: readonly unknown[],
  ) => Effect.Effect<BridgeContract[C]["result"], unknown, Account | DesktopPlaylists>;
};

const refuse = (call: PlaylistCall, why: string) =>
  Effect.fail(new Error(`Refused ${call}: ${why}`));

const id = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const name = (value: unknown): value is string => typeof value === "string" && value.length <= 500;

const fraction = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const framing = (value: unknown): value is ImageFraming => {
  if (typeof value !== "object" || value === null) return false;
  const { zoom, centerX, centerY } = value as ImageFraming;
  return (
    typeof zoom === "number" &&
    Number.isFinite(zoom) &&
    zoom > 0 &&
    fraction(centerX) &&
    fraction(centerY)
  );
};

const answers = (value: unknown): value is ImportAnswer[] =>
  Array.isArray(value) &&
  value.length <= 500 &&
  value.every((answer) => answer === "replace" || answer === "keepBoth");

const playlistsCall = <A>(run: (playlists: PlaylistsShape) => A | Promise<A>) =>
  Effect.gen(function* () {
    const playlists = yield* DesktopPlaylists;
    return yield* Effect.tryPromise({ try: async () => run(playlists), catch: (error) => error });
  });

/** The playlist calls; [validTarget] is the bridge's check of a song target. */
export const playlistHandlers = (
  validTarget: (value: unknown) => value is SongTarget,
): PlaylistHandlers => ({
  "playlists.checkName": ([text, playlistId]) =>
    name(text) && (playlistId === undefined || id(playlistId))
      ? playlistsCall((p) => p.checkName(text, playlistId))
      : refuse("playlists.checkName", "invalid name"),
  // In the language main resolved: the window's own idea of it is never asked.
  "playlists.newName": () =>
    Effect.flatMap(Account, (account) =>
      playlistsCall((p) => p.newName(account.language().language)),
    ),
  "playlists.create": ([text, target]) =>
    name(text) && (target === undefined || validTarget(target) || validCollectionTarget(target))
      ? playlistsCall((p) => p.create(text, target))
      : refuse("playlists.create", "invalid name or songs"),
  "playlists.rename": ([playlistId, text]) =>
    id(playlistId) && name(text)
      ? playlistsCall((p) => p.rename(playlistId, text))
      : refuse("playlists.rename", "invalid playlist or name"),
  "playlists.delete": ([playlistId]) =>
    id(playlistId)
      ? playlistsCall((p) => p.delete(playlistId))
      : refuse("playlists.delete", "invalid playlist"),
  "playlists.info": ([playlistId]) =>
    id(playlistId)
      ? playlistsCall((p) => p.info(playlistId))
      : refuse("playlists.info", "invalid playlist"),
  "playlists.undoRemove": () => playlistsCall((p) => p.undoRemove()),
  "playlists.move": ([playlistId, trackId, direction]) =>
    id(playlistId) && id(trackId) && (direction === "up" || direction === "down")
      ? playlistsCall((p) => p.move(playlistId, trackId, direction))
      : refuse("playlists.move", "invalid playlist, song or direction"),
  "playlists.graveyard": ([playlistId, offset, limit]) =>
    id(playlistId) &&
    typeof offset === "number" &&
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    typeof limit === "number" &&
    Number.isSafeInteger(limit) &&
    limit >= 1 &&
    limit <= 200
      ? playlistsCall((p) => p.graveyard(playlistId, offset, limit))
      : refuse("playlists.graveyard", "invalid playlist or page"),
  "playlists.restore": ([playlistId, itemId]) =>
    id(playlistId) && id(itemId)
      ? playlistsCall((p) => p.restore(playlistId, itemId))
      : refuse("playlists.restore", "invalid playlist or song"),
  "playlists.forget": ([playlistId, itemId]) =>
    id(playlistId) && (itemId === undefined || id(itemId))
      ? playlistsCall((p) => p.forget(playlistId, itemId))
      : refuse("playlists.forget", "invalid playlist or song"),
  "playlists.chooseImport": () => playlistsCall((p) => p.chooseImport()),
  "playlists.runImport": ([given]) =>
    answers(given)
      ? playlistsCall((p) => p.runImport(given))
      : refuse("playlists.runImport", "invalid answers"),
  "playlists.pickImage": ([playlistId]) =>
    id(playlistId)
      ? playlistsCall((p) => p.pickImage(playlistId))
      : refuse("playlists.pickImage", "invalid playlist"),
  "playlists.adjustImage": ([playlistId]) =>
    id(playlistId)
      ? playlistsCall((p) => p.adjustImage(playlistId))
      : refuse("playlists.adjustImage", "invalid playlist"),
  "playlists.saveImage": ([playlistId, given]) =>
    id(playlistId) && framing(given)
      ? playlistsCall((p) =>
          p.saveImage(playlistId, {
            zoom: given.zoom,
            centerX: given.centerX,
            centerY: given.centerY,
          }),
        )
      : refuse("playlists.saveImage", "invalid playlist or framing"),
  "playlists.cancelImage": () => playlistsCall((p) => p.cancelImage()),
  "playlists.removeImage": ([playlistId]) =>
    id(playlistId)
      ? playlistsCall((p) => p.removeImage(playlistId))
      : refuse("playlists.removeImage", "invalid playlist"),
  "playlists.image": ([playlistId, large]) =>
    id(playlistId) && typeof large === "boolean"
      ? playlistsCall((p) => p.image(playlistId, large))
      : refuse("playlists.image", "invalid playlist"),
  "playlists.place": ([playlistId, target, before]) =>
    id(playlistId) &&
    validTarget(target) &&
    (before === null ||
      (typeof before === "number" && Number.isSafeInteger(before) && before !== 0))
      ? playlistsCall((p) => p.place(playlistId, target, before))
      : refuse("playlists.place", "invalid playlist, songs or place"),
  "playlists.listView": () => playlistsCall((p) => p.listView()),
  "playlists.sortList": ([sort]) =>
    PLAYLIST_SORTS.some((choice) => choice.sort === sort)
      ? playlistsCall((p) => p.sortList(sort as PlaylistSort))
      : refuse("playlists.sortList", "invalid sort"),
  "playlists.showListAs": ([layout]) =>
    DESKTOP_PLAYLIST_LAYOUTS.includes(layout as PlaylistLayout)
      ? playlistsCall((p) => p.showListAs(layout as PlaylistLayout))
      : refuse("playlists.showListAs", "invalid layout"),
  "playlists.moveInList": ([playlistId, to]) =>
    id(playlistId) && typeof to === "number" && Number.isSafeInteger(to)
      ? playlistsCall((p) => p.moveInList(playlistId, to))
      : refuse("playlists.moveInList", "invalid playlist or place"),
  "playlists.playGraveyard": ([playlistId, itemId]) =>
    id(playlistId) && id(itemId)
      ? playlistsCall((p) => p.playGraveyard(playlistId, itemId))
      : refuse("playlists.playGraveyard", "invalid playlist or song"),
});
