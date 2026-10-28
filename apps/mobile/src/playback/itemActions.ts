import { beginTiming } from "@/lib/timing";
import {
  confirmsFirst,
  isDestructiveAction,
  isDetailPath,
  ITEM_ACTION_LABELS,
  itemActions,
  playlistPlayback,
  playlistRemovals,
  unsearchedSongJob,
  type ActionSurface,
  type FavoriteSource,
  type ItemAction,
  type ItemActionEntry,
  type MagicSeed,
  albumDownloadOrigin,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Haptics from "expo-haptics";
import { usePathname } from "expo-router";
import { router } from "@/lib/timingRouter";
import { useMemo } from "react";

import { followArtistLink, followStreamedArtistLink } from "@/library/ArtistChoice";
import { confirmDeleteSongs, confirmRemoveSongs } from "@/library/deleteSongs";
import type { LinkRows } from "@/library/db/links";
import { songHasFile, type ArtistRow, type SongRow } from "@/library/LibraryStore";
import { useLiveFavoriteIds, useLivePendingFavoriteVideos } from "@/library/favorites";
import { starSongs } from "@/library/starSongs";
import { fixSongs } from "@/library/findLyricsAndGenre";
import {
  readCollectionSongs,
  useAlbumsMissingSongs,
  useCollectionSongs,
  useLinkRows,
  type SongsCollection,
} from "@/library/hooks";
import {
  adjustPlaylistImageFlow,
  changePlaylistImageFlow,
  confirmDeletePlaylists,
  openAddToPlaylist,
  removePlaylistImageFlow,
  renamePlaylistFlow,
} from "@/library/PlaylistSheets";
import { removePlaylistItems } from "@/library/playlists";
import { openAlbum } from "@/library/routes";
import { showError } from "@/overlay/alert";
import {
  lyricsAndGenreLookupsEnabled,
  useLyricsAndGenreLookupsEnabled,
} from "@/settings/lyricsAndGenre";
import { ytMusicEnabled, useYtMusicEnabled } from "@/settings/ytMusic";
import { openSharePlaylist } from "@/share/sharePlaylist";
import { shareLibrarySong, shareStreamedSong } from "@/share/songShare";
import {
  cancelMissingSongDownload,
  downloadMissingSongs,
  runMissingSongsDownloadAction,
  useMissingSongDownloadStatus,
  useMissingSongDownloadStatuses,
  downloadYtSong,
} from "@/ytmusic/YtDownloads";
import {
  currentLibraryFinder,
  useLibraryFinder,
  type FindInLibrary,
} from "@/ytmusic/libraryFinder";
import { useStreamedArtistContext } from "@/ytmusic/streamedArtist";

import {
  collectionSongFacts,
  targetCount,
  targetEntries,
  targetFacts,
  targetHeading,
  toPlaylistSongs,
  hasStreamedSongs,
  targetStreamedArtistNames,
  isLibraryTrack,
  isUnsearchedTrack,
  tracksTarget,
  type ActionItems,
  type TargetEntry,
} from "./actionTargets";
import { addToQueue, playNext, queueDiscoverSongs } from "./actions";
import { goToArtistPress } from "./goToArtistPress";
import { startMagicQueue } from "./MagicQueue";
import { runMagicQueueStart } from "./magicQueueStart";

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
  /** The songs of the collection the menu is about, read before it opened (`readMenuSongs`). */
  readonly collectionSongs?: readonly SongRow[] | undefined;
  /** The song is the one playing: Core's `itemActions` leaves out Play Next and Add to Queue. */
  readonly playing?: boolean | undefined;
}

/** What a Magic Queue started from [target]'s menu grows from: its one song, album, artist or playlist. */
const magicSeed = (target: ActionItems): MagicSeed | null => {
  switch (target.kind) {
    case "track": {
      const [only] = target.items;
      return only === undefined || !isLibraryTrack(only)
        ? null
        : { kind: "track", id: String(only.song.id), title: only.song.title };
    }
    case "album": {
      const [only] = target.items;
      return only === undefined ? null : { kind: "album", id: String(only.id), title: only.title };
    }
    case "artist":
    case "playlist": {
      const [only] = target.items;
      return only === undefined
        ? null
        : { kind: target.kind, id: String(only.id), title: only.name };
    }
    default:
      return null;
  }
};

/** The one missing song [target] is, if it is one: its menu offers its download. */
const onlyMissingSong = (target: ActionItems): number | null => {
  const only = target.kind === "track" && target.items.length === 1 ? target.items[0] : undefined;
  return only === undefined || !isLibraryTrack(only) || songHasFile(only.song)
    ? null
    : only.song.id;
};

/**
 * The Library finder, read only while YT Music songs are among the items
 * ([streams]): the Library song each is by now, if any.
 */
const useStreamedSongFinder = (streams: boolean): FindInLibrary => useLibraryFinder(streams);

/**
 * The one album, artist, playlist or genre [target]'s menu is about, while
 * online lookups are on: its songs tell whether it offers Fix Songs.
 */
const menuCollection = (
  target: ActionItems,
  surface: ActionSurface,
  onlineLookups: boolean,
): { readonly kind: SongsCollection; readonly id: number } | null => {
  if (surface !== "menu" || !onlineLookups || target.items.length !== 1) return null;
  switch (target.kind) {
    case "album":
    case "artist":
    case "playlist":
    case "genre": {
      const [only] = target.items;
      return only === undefined ? null : { kind: target.kind, id: only.id };
    }
    default:
      return null;
  }
};

const NO_SONGS: readonly SongRow[] = [];

/**
 * What [target]'s menu reads before it opens: the songs of the collection
 * it's about, while online lookups are on, so Fix Songs is there from the
 * first frame instead of joining later and moving the entries under a
 * sliding finger. Undefined for other menus, or when they can't be read.
 */
export const readMenuSongs = (target: ActionItems): Promise<readonly SongRow[] | undefined> => {
  const collection = menuCollection(target, "menu", lyricsAndGenreLookupsEnabled());
  return collection === null
    ? Promise.resolve(undefined)
    : readCollectionSongs(collection.kind, collection.id).catch(() => undefined);
};

interface PlanOptions {
  readonly surface: ActionSurface;
  readonly selectable: boolean;
  /** The collection's songs, read before the menu opened. */
  readonly collectionSongs?: readonly SongRow[] | undefined;
  readonly playing?: boolean | undefined;
}

/**
 * The entries for [target] (`usePlannedActions`), and its albums' missing
 * songs as Track ids, all albums' in one list: what their download entries
 * act on.
 */
function usePlan(
  target: ActionItems,
  favorites: ReadonlySet<number>,
  { surface, selectable, collectionSongs: readFirst, playing }: PlanOptions,
): {
  readonly planned: readonly ItemActionEntry<ArtistRow>[];
  readonly missingSongs: readonly number[];
  /** Each album's missing songs, in the albums' order. */
  readonly perAlbum: readonly (readonly number[])[];
  /** The Library songs of the collection the menu is about (none otherwise): what Fix Songs runs on. */
  readonly collectionSongs: readonly SongRow[];
} {
  const here = usePathname();
  const onlineLookups = useLyricsAndGenreLookupsEnabled();
  const ytMusic = useYtMusicEnabled();
  const download = useMissingSongDownloadStatus(onlyMissingSong(target));
  // YT Music songs among the items: whether each is a file by now, and who their artists are.
  const deferred = target.readOnAction === true;
  const streams = hasStreamedSongs(target);
  const loadedFind = useStreamedSongFinder(streams && !deferred);
  const find = deferred ? noMatch : loadedFind;
  const streamedArtists = useStreamedArtistContext(
    streams && !deferred,
    !deferred && (target.kind === "mixed" || (target.kind === "track" && target.items.length > 1))
      ? targetStreamedArtistNames(target)
      : undefined,
  );
  const perAlbum = useAlbumsMissingSongs(
    !deferred && target.kind === "album" ? target.items.map((album) => album.id) : [],
  );
  const missingSongs = useMemo(() => perAlbum.flat(), [perAlbum]);
  const statuses = useMissingSongDownloadStatuses(missingSongs);
  // Kept current while the menu shows; the songs read before it opened stand in until then.
  const collectionSongs =
    useCollectionSongs(menuCollection(target, surface, onlineLookups)) ?? readFirst ?? NO_SONGS;
  const songFacts = useMemo(() => collectionSongFacts(collectionSongs), [collectionSongs]);
  // Each album's share of [statuses], in the albums' order.
  const albumStatuses = (index: number) => {
    const start = perAlbum.slice(0, index).reduce((sum, ids) => sum + ids.length, 0);
    return statuses.slice(start, start + (perAlbum[index]?.length ?? 0));
  };
  // Starred YT Music songs waiting for their files: their Favorite reads Remove from Favorites.
  const pending = useLivePendingFavoriteVideos(!deferred);
  const facts = targetFacts(target, favorites, find, pending);
  const planned = itemActions({
    kind: target.kind,
    ytMusic,
    items: facts.map((item, index) =>
      item.missing === true
        ? { ...item, download }
        : target.kind === "album"
          ? { ...item, missingSongs: albumStatuses(index), songs: songFacts }
          : songFacts.length > 0
            ? { ...item, songs: songFacts }
            : item,
    ),
    surface,
    selectable,
    onlineLookups,
    here,
    streamedArtists,
    playing,
  });
  return { planned, missingSongs, perAlbum, collectionSongs };
}

/**
 * The entries Core's `itemActions` offers for [target] on [surface], here and
 * with the Settings as they are; [favorites] says which tracks are starred,
 * and the downloads of a missing song, or of an album's missing songs, are
 * followed as they go.
 * The Design preview plans its menus with it too, from synthetic items.
 */
export const usePlannedActions = (
  target: ActionItems,
  favorites: ReadonlySet<number>,
  options: PlanOptions,
): readonly ItemActionEntry<ArtistRow>[] => usePlan(target, favorites, options).planned;

/**
 * [planned] as entries: each labelled, deleting ones in the destructive
 * colour, [press] giving what each does. The Design preview's entries only
 * close their card.
 */
export const actionEntries = <A extends { readonly id: number; readonly name: string }>(
  planned: readonly ItemActionEntry<A>[],
  press: (entry: ItemActionEntry<A>) => () => void,
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
  { surface, finish, onSelect, collectionSongs: readFirst, playing }: ActionOptions,
): readonly ActionEntry[] {
  const here = usePathname();
  const deferred = target.readOnAction === true;
  const favorites = useLiveFavoriteIds(!deferred);
  const find = useStreamedSongFinder(hasStreamedSongs(target) && !deferred);

  // [missingSongs]: the albums' missing songs, which their download entries act on.
  const { planned, missingSongs, perAlbum, collectionSongs } = usePlan(target, favorites, {
    surface,
    selectable: onSelect !== undefined,
    collectionSongs: readFirst,
    playing,
  });

  // Read ahead, so Go to Album / Go to Artist open header-first.
  let goAlbumId: number | undefined;
  let goArtistId: number | undefined;
  for (const entry of planned) {
    if (entry.action === "goToAlbum") goAlbumId = entry.albumId;
    if (entry.action === "goToArtist" && "artists" in entry && entry.artists.kind === "open")
      goArtistId = entry.artists.artistId;
  }
  const links = useLinkRows(goAlbumId, goArtistId, !deferred);

  const context: PressContext = {
    target,
    surface,
    finish,
    onSelect,
    here,
    find,
    links,
    missingSongs,
    perAlbum,
    collectionSongs,
  };
  const press = itemActionPress(context);
  return actionEntries(planned, (entry) => {
    if (!deferred || !SONG_ACTIONS.has(entry.action)) return press(entry);
    return () => {
      finish();
      void resolveSelectionTarget(target)
        .then(({ target: resolved, find: currentFind }) => {
          itemActionPress({ ...context, target: resolved, find: currentFind, finish: () => {} })(
            entry,
          )();
        })
        .catch((error: unknown) => showError("Couldn't load the songs", error));
    };
  });
}

const noMatch: FindInLibrary = () => null;
const SONG_ACTIONS: ReadonlySet<ItemAction> = new Set([
  "playNext",
  "addToQueue",
  "addToPlaylist",
  "favorite",
  "unfavorite",
  "download",
  "retryDownload",
]);

/** Acquire release tracks and current Library identities after the owner chooses an action. */
const resolveSelectionTarget = async (target: ActionItems) => {
  const entries = await targetEntries(target);
  const find = entries.some((entry) => entry.source === "stream")
    ? await currentLibraryFinder()
    : noMatch;
  return {
    find,
    target: tracksTarget(
      entries.map((entry) => {
        if (entry.source === "library") return { song: entry.track };
        if (entry.source === "unsearched") return { unsearched: entry.song };
        const track = find(entry.song);
        return track?.path == null ? { ytSong: entry.song } : { song: track };
      }),
    ),
  };
};

/** Where an entry runs: what `useItemActions` read for it, or what a row's swipe has at hand. */
export interface PressContext {
  readonly target: ActionItems;
  readonly surface: ActionSurface;
  /** A swipe runs a menu entry, but confirms its favorite as a swipe. */
  readonly favoriteSource?: FavoriteSource | undefined;
  /** Runs before an entry's action: the menu closes, the selection ends. */
  readonly finish: () => void;
  readonly onSelect?: (() => void) | undefined;
  /** The current route. */
  readonly here: string;
  /** The Library song a YT Music song is by now, if any. */
  readonly find: FindInLibrary;
  /** The album and artist Go to opens, read ahead so their pages open header-first. */
  readonly links?: LinkRows | undefined;
  /** The albums' missing songs, all albums' in one list, and each album's. */
  readonly missingSongs?: readonly number[] | undefined;
  readonly perAlbum?: readonly (readonly number[])[] | undefined;
  /** The Library songs of the collection the menu is about: what Fix Songs runs on. */
  readonly collectionSongs?: readonly SongRow[] | undefined;
}

const NO_LINKS: LinkRows = { album: null, artist: null };
const NO_IDS: readonly number[] = [];

/**
 * What each of [context]'s target's entries does, as the menu and the
 * selection bar run it; a song row's swipe runs its entry the same way.
 */
export const itemActionPress = ({
  target,
  surface,
  favoriteSource = surface,
  finish,
  onSelect,
  here,
  find,
  links = NO_LINKS,
  missingSongs = NO_IDS,
  perAlbum = [],
  collectionSongs = NO_SONGS,
}: PressContext): ((entry: ItemActionEntry<ArtistRow>) => () => void) => {
  const allTracks = target.kind === "track" ? target.items : [];
  const tracks = allTracks.filter(isLibraryTrack);
  // What acts on files (Delete, Fix Song) shows only when every song has one.
  const withFiles = tracks.flatMap(({ song }) => (songHasFile(song) ? [song] : []));
  // A YT Music song downloaded since it was checked is the Library's file now.
  const entriesNow = () =>
    targetEntries(target).then((entries) =>
      entries.map((entry): TargetEntry => {
        const track = entry.source === "stream" ? find(entry.song) : null;
        return track === null || !songHasFile(track) ? entry : { source: "library", track };
      }),
    );

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
      entriesNow()
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
      // A star means downloaded: songs with no file here join the download queue with it.
      void starSongs(
        {
          tracks: tracks.map(({ song }) => song),
          ytSongs: allTracks.flatMap((item) => ("ytSong" in item ? [item.ytSong] : [])),
        },
        on,
        find,
        favoriteSource,
      );
    });

  const playlist = target.kind === "playlist" ? target.items[0] : undefined;
  const addTitle =
    surface === "menu"
      ? (targetHeading(target, undefined)?.title ?? targetCount(target))
      : targetCount(target);

  return (entry) => {
    switch (entry.action) {
      case "playNext":
        return queue("playNext");
      case "addToQueue":
        return queue("addToQueue");
      case "magicQueue":
        return run(() => {
          const seed = magicSeed(target);
          if (seed === null) return;
          runMagicQueueStart(
            Effect.flatMap(Effect.tryPromise(entriesNow), (entries) =>
              startMagicQueue(
                seed,
                entries.flatMap((song) => (song.source === "library" ? [song.track] : [])),
                entries.flatMap((song) => (song.source === "stream" ? [song.song] : [])),
              ),
            ),
          );
        });
      case "addToPlaylist":
        return run(() =>
          openAddToPlaylist({
            title: addTitle,
            songs: () => entriesNow().then(toPlaylistSongs),
          }),
        );
      case "favorite":
        return star(true);
      case "unfavorite":
        return star(false);
      case "removeFromPlaylist":
        return run(() => {
          const places = allTracks.flatMap(({ playlistItem }) => playlistItem ?? []);
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
      case "goToArtist":
        return goToArtistPress(entry, {
          begin: () => beginTiming("goToArtist", "Artist"),
          run,
          follow: (artists) => followArtistLink(artists, links.artist),
          followStreamed: followStreamedArtistLink,
        });
      case "renamePlaylist":
        return run(() => playlist !== undefined && void renamePlaylistFlow(playlist));
      case "changeImage":
        return run(() => playlist !== undefined && void changePlaylistImageFlow(playlist));
      case "adjustImage":
        return run(() => playlist !== undefined && void adjustPlaylistImageFlow(playlist));
      case "removeImage":
        return run(() => playlist !== undefined && void removePlaylistImageFlow(playlist));
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
        // Only the songs missing something are fixed (Core's `songsToFix`); a
        // collection's are its Library files, the others counted as skipped.
        return run(
          () =>
            void fixSongs(
              target.kind === "track" ? withFiles : collectionSongs.filter(songHasFile),
            ),
        );
      case "share":
        // A playlist goes out as a playlist on another service (#483); one song, as a card on
        // the song share sheet: a Library song, a YT Music one or an unsearched entry (#481).
        if (playlist !== undefined) return run(() => openSharePlaylist(playlist));
        return run(() => {
          const [only] = allTracks;
          if (only === undefined) return;
          if (isLibraryTrack(only)) shareLibrarySong(only.song);
          else shareStreamedSong(isUnsearchedTrack(only) ? only.unsearched : only.ytSong);
        });
      case "select":
        return run(() => onSelect?.());
      case "delete":
        return asking(entry.action, (onConfirm) => {
          void confirmDeleteSongs(withFiles, { onConfirm });
        });
      case "download":
      case "retryDownload":
        // Missing songs download into their Library entries; YT Music songs
        // the Library doesn't have yet download as new songs, and an
        // unsearched one as the job that searches it first.
        return run(() => {
          const missing: number[] = [];
          for (const item of allTracks) {
            if (isLibraryTrack(item)) {
              if (!songHasFile(item.song)) missing.push(item.song.id);
              continue;
            }
            const ytSong = isUnsearchedTrack(item)
              ? unsearchedSongJob(item.unsearched)
              : item.ytSong;
            const song = find(ytSong);
            if (song === null) downloadYtSong(ytSong);
            else if (!songHasFile(song)) missing.push(song.id);
          }
          if (missing.length > 0) downloadMissingSongs(missing);
        });
      case "cancelDownload":
        return run(() => {
          if (target.kind === "album") runMissingSongsDownloadAction("cancel", missingSongs);
          for (const { song } of tracks) cancelMissingSongDownload(song.id);
        });
      // An album's missing songs, as Settings' Download All does them; each album's remember it.
      case "downloadMissingSongs":
      case "retryFailed":
        return run(() => {
          if (target.kind !== "album") return;
          const action = entry.action === "retryFailed" ? "retryFailed" : "downloadAll";
          target.items.forEach((album, index) => {
            const trackIds = perAlbum[index] ?? [];
            if (trackIds.length === 0) return;
            runMissingSongsDownloadAction(action, trackIds, albumDownloadOrigin(album));
          });
        });
      case "removeFromLibrary": {
        const songs = tracks.map(({ song }) => song);
        return asking(entry.action, (onConfirm) => {
          void confirmRemoveSongs(songs, { onConfirm });
        });
      }
    }
  };
};
