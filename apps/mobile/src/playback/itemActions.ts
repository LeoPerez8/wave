import {
  confirmsFirst,
  isDestructiveAction,
  isDetailPath,
  ITEM_ACTION_LABELS,
  itemActions,
  playlistRemovals,
  type ActionSurface,
  type ItemAction,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import { router, usePathname } from "expo-router";

import { followArtistLink } from "@/library/ArtistChoice";
import { confirmDeleteSongs } from "@/library/deleteSongs";
import { setFavorites, useFavoriteIds } from "@/library/favorites";
import { findLyricsAndGenreFor } from "@/library/findLyricsAndGenre";
import { useLinkRows } from "@/library/hooks";
import type { SongRow } from "@/library/LibraryStore";
import {
  confirmDeletePlaylists,
  openAddToPlaylist,
  renamePlaylistFlow,
} from "@/library/PlaylistSheets";
import { removePlaylistItems } from "@/library/playlists";
import { openAlbum } from "@/library/routes";
import { showError } from "@/overlay/alert";
import { useLyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";

import {
  targetCount,
  targetFacts,
  targetHeading,
  targetSongs,
  type ActionItems,
} from "./actionTargets";
import { addToQueue, playNext } from "./actions";

/**
 * Wave's actions on library items, defined once for the long-press menu (one
 * item) and the selection bar (the checked items): Core's `itemActions`
 * decides which entries show, this module what each one does. What they act
 * on is `actionTargets.ts`.
 */

/** One entry, as a menu row or a bar button shows it. */
export interface ActionEntry {
  readonly action: ItemAction;
  readonly label: string;
  readonly onPress: () => void;
  /** Deletes something for good: shown in the destructive colour. */
  readonly destructive: boolean;
}

export interface ActionOptions {
  readonly surface: ActionSurface;
  /** Runs before an entry's action: the menu closes, the selection ends. */
  readonly finish: () => void;
  /** The menu's list can select: offers Select, which calls this. */
  readonly onSelect?: (() => void) | undefined;
}

/**
 * The entries to show for [target] (Core decides which), each wired to what it
 * does. [target] is resolved when an entry runs, so a bar can pass the
 * selection as it is at that moment.
 */
export function useItemActions(
  target: ActionItems,
  { surface, finish, onSelect }: ActionOptions,
): readonly ActionEntry[] {
  const here = usePathname();
  const favorites = useFavoriteIds();
  const onlineLookups = useLyricsAndGenreLookupsEnabled();
  const facts = targetFacts(target, favorites);
  const tracks = target.kind === "track" ? target.items : [];

  const run = (action: () => void) => () => {
    finish();
    action();
  };

  /**
   * An action that asks first ([ask] passes on what runs once confirmed): in
   * selection, selection mode ends only once confirmed, so Cancel keeps it.
   */
  const asking = (
    action: ItemAction,
    ask: (onConfirm: (() => void) | undefined) => void,
  ): (() => void) =>
    surface === "selection" && confirmsFirst(action)
      ? () => ask(finish)
      : run(() => ask(undefined));

  const queue = (add: (songs: readonly SongRow[]) => void) =>
    run(() => {
      targetSongs(target)
        .then(add)
        .catch((error: unknown) => showError("Couldn't load the songs", error));
    });

  const star = (on: boolean) =>
    run(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      void setFavorites(
        tracks.map(({ song }) => song.id),
        on,
      );
    });

  const playlist = target.kind === "playlist" ? target.items[0] : undefined;
  const addTitle =
    surface === "menu"
      ? (targetHeading(target, undefined)?.title ?? targetCount(target))
      : targetCount(target);

  const planned = itemActions({
    kind: target.kind,
    items: facts,
    surface,
    selectable: onSelect !== undefined,
    onlineLookups,
    here,
  });

  // Read ahead, so Go to Album / Go to Artist open header-first.
  let goAlbumId: number | undefined;
  let goArtistId: number | undefined;
  for (const entry of planned) {
    if (entry.action === "goToAlbum") goAlbumId = entry.albumId;
    if (entry.action === "goToArtist" && entry.artists.kind === "open")
      goArtistId = entry.artists.artistId;
  }
  const links = useLinkRows(goAlbumId, goArtistId);

  return planned.map((entry): ActionEntry => {
    const label = ITEM_ACTION_LABELS[entry.action];
    const make = (onPress: () => void): ActionEntry => ({
      action: entry.action,
      label,
      onPress,
      destructive: isDestructiveAction(entry.action),
    });
    switch (entry.action) {
      case "playNext":
        return make(queue(playNext));
      case "addToQueue":
        return make(queue(addToQueue));
      case "addToPlaylist":
        return make(
          run(() => openAddToPlaylist({ title: addTitle, songs: () => targetSongs(target) })),
        );
      case "favorite":
        return make(star(true));
      case "unfavorite":
        return make(star(false));
      case "removeFromPlaylist":
        return make(
          run(() => {
            const places = tracks.flatMap(({ playlistItem }) => playlistItem ?? []);
            for (const { playlistId, itemIds } of playlistRemovals(places)) {
              removePlaylistItems(playlistId, itemIds).catch((error: unknown) =>
                showError("Couldn't remove the songs", error),
              );
            }
          }),
        );
      case "goToAlbum": {
        const { albumId } = entry;
        return make(run(() => openAlbum(albumId, links.album)));
      }
      case "goToArtist": {
        // Several credited artists: a card to pick one from (`ArtistChoice`).
        const { artists } = entry;
        return make(run(() => followArtistLink(artists, links.artist)));
      }
      case "renamePlaylist":
        return make(run(() => playlist !== undefined && void renamePlaylistFlow(playlist)));
      case "deletePlaylist":
      case "deletePlaylists": {
        const playlists = target.kind === "playlist" ? target.items : [];
        const onDeleted = () => {
          // Leave a playlist's screen once it's gone.
          if (playlists.some(({ id }) => isDetailPath(here, "playlist", id))) router.back();
        };
        return make(
          asking(entry.action, (onConfirm) => {
            void confirmDeletePlaylists(playlists, { onConfirm, onDeleted });
          }),
        );
      }
      case "findLyricsAndGenre":
        return make(run(() => void findLyricsAndGenreFor(tracks.map(({ song }) => song))));
      case "select":
        return make(run(() => onSelect?.()));
      case "delete": {
        const songs = tracks.map(({ song }) => song);
        return make(
          asking(entry.action, (onConfirm) => {
            void confirmDeleteSongs(songs, { onConfirm });
          }),
        );
      }
    }
  });
}
