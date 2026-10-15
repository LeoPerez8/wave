import {
  confirmsFirst,
  isDestructiveAction,
  isDetailPath,
  ITEM_ACTION_LABELS,
  itemActions,
  playlistPlayback,
  playlistRemovals,
  type ActionSurface,
  type ItemAction,
  type ItemActionEntry,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import { router, usePathname } from "expo-router";

import { followArtistLink } from "@/library/ArtistChoice";
import { confirmDeleteSongs, confirmRemoveSongs } from "@/library/deleteSongs";
import { songHasFile } from "@/library/LibraryStore";
import { setFavorites, useFavoriteIds } from "@/library/favorites";
import { fixSongs } from "@/library/findLyricsAndGenre";
import { useLinkRows } from "@/library/hooks";
import {
  confirmDeletePlaylists,
  openAddToPlaylist,
  renamePlaylistFlow,
} from "@/library/PlaylistSheets";
import { removePlaylistItems } from "@/library/playlists";
import { openAlbum } from "@/library/routes";
import { showError } from "@/overlay/alert";
import { useLyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";
import { ytMusicEnabled } from "@/settings/ytMusic";
import {
  cancelMissingSongDownload,
  downloadMissingSongs,
  useMissingSongDownloadStatus,
} from "@/ytmusic/YtDownloads";

import {
  targetCount,
  targetEntries,
  targetFacts,
  targetHeading,
  toPlaylistSongs,
  type ActionItems,
} from "./actionTargets";
import { addToQueue, playNext, queueDiscoverSongs } from "./actions";

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

/** The one missing song [target] is, if it is one: its menu offers its download. */
const onlyMissingSong = (target: ActionItems): number | null => {
  const only = target.kind === "track" && target.items.length === 1 ? target.items[0] : undefined;
  return only === undefined || songHasFile(only.song) ? null : only.song.id;
};

/**
 * The entries Core's `itemActions` offers for [target] on [surface], here and
 * with the Settings as they are; [favorites] says which tracks are starred,
 * and a missing song's download is followed as it goes.
 * The Design preview plans its menus with it too, from synthetic items.
 */
export function usePlannedActions(
  target: ActionItems,
  favorites: ReadonlySet<number>,
  { surface, selectable }: { readonly surface: ActionSurface; readonly selectable: boolean },
): readonly ItemActionEntry[] {
  const here = usePathname();
  const onlineLookups = useLyricsAndGenreLookupsEnabled();
  const download = useMissingSongDownloadStatus(onlyMissingSong(target));
  const facts = targetFacts(target, favorites);
  return itemActions({
    kind: target.kind,
    items: facts.map((item) => (item.missing === true ? { ...item, download } : item)),
    surface,
    selectable,
    onlineLookups,
    here,
  });
}

/**
 * [planned] as entries: each labelled, deleting ones in the destructive
 * colour, [press] giving what each does. The Design preview's entries only
 * close their card.
 */
export const actionEntries = (
  planned: readonly ItemActionEntry[],
  press: (entry: ItemActionEntry) => () => void,
): ActionEntry[] =>
  planned.map((entry) => ({
    action: entry.action,
    label: ITEM_ACTION_LABELS[entry.action],
    onPress: press(entry),
    destructive: isDestructiveAction(entry.action),
  }));

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
  const tracks = target.kind === "track" ? target.items : [];
  // What acts on files (Delete, Fix Song) shows only when every song has one.
  const withFiles = tracks.flatMap(({ song }) => (songHasFile(song) ? [song] : []));

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

  // A playlist's YT Music entries join the queue streamed, while YT Music is on
  // (Core's `playlistPlayback`); other items are the Library's songs.
  const queue = (where: "playNext" | "addToQueue") =>
    run(() => {
      targetEntries(target)
        .then((entries) => {
          const play = playlistPlayback(entries, { ytMusic: ytMusicEnabled() });
          if (play === null) return;
          if (play.playback.kind === "mixed") void queueDiscoverSongs(play.playback.songs, where);
          else void (where === "playNext" ? playNext : addToQueue)(play.playback.tracks);
        })
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

  const planned = usePlannedActions(target, favorites, {
    surface,
    selectable: onSelect !== undefined,
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

  return actionEntries(planned, (entry): (() => void) => {
    switch (entry.action) {
      case "playNext":
        return queue("playNext");
      case "addToQueue":
        return queue("addToQueue");
      case "addToPlaylist":
        return run(() =>
          openAddToPlaylist({
            title: addTitle,
            songs: () => targetEntries(target).then(toPlaylistSongs),
          }),
        );
      case "favorite":
        return star(true);
      case "unfavorite":
        return star(false);
      case "removeFromPlaylist":
        return run(() => {
          const places = tracks.flatMap(({ playlistItem }) => playlistItem ?? []);
          for (const { playlistId, itemIds } of playlistRemovals(places)) {
            removePlaylistItems(playlistId, itemIds).catch((error: unknown) =>
              showError("Couldn't remove the songs", error),
            );
          }
        });
      case "goToAlbum": {
        const { albumId } = entry;
        return run(() => openAlbum(albumId, links.album));
      }
      case "goToArtist": {
        // Several credited artists: a card to pick one from (`ArtistChoice`).
        const { artists } = entry;
        return run(() => followArtistLink(artists, links.artist));
      }
      case "renamePlaylist":
        return run(() => playlist !== undefined && void renamePlaylistFlow(playlist));
      case "deletePlaylist":
      case "deletePlaylists": {
        const playlists = target.kind === "playlist" ? target.items : [];
        const onDeleted = () => {
          // Leave a playlist's screen once it's gone.
          if (playlists.some(({ id }) => isDetailPath(here, "playlist", id))) router.back();
        };
        return asking(entry.action, (onConfirm) => {
          void confirmDeletePlaylists(playlists, { onConfirm, onDeleted });
        });
      }
      case "fixSong":
      case "fixSongs":
        // Only the songs missing something are fixed (Core's `songsToFix`).
        return run(() => void fixSongs(withFiles));
      case "select":
        return run(() => onSelect?.());
      case "delete":
        return asking(entry.action, (onConfirm) => {
          void confirmDeleteSongs(withFiles, { onConfirm });
        });
      case "download":
      case "retryDownload":
        return run(() => downloadMissingSongs(tracks.map(({ song }) => song.id)));
      case "cancelDownload":
        return run(() => {
          for (const { song } of tracks) cancelMissingSongDownload(song.id);
        });
      case "removeFromLibrary": {
        const songs = tracks.map(({ song }) => song);
        return asking(entry.action, (onConfirm) => {
          void confirmRemoveSongs(songs, { onConfirm });
        });
      }
    }
  });
}
