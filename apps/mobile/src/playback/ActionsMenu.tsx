import { entryDivider, isDetailPath } from "@wave/core";
import * as Haptics from "expo-haptics";
import { router, usePathname } from "expo-router";
import { Text, View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { Mosaic } from "@/catalog/Mosaic";
import type { LibrarySection } from "@/catalog/sections";
import type { LibraryCounts } from "@/library/db/counts";
import { setFavorite, useIsFavorite } from "@/library/favorites";
import { confirmDeleteSongs } from "@/library/deleteSongs";
import { useSectionSongCounts } from "@/library/hooks";
import type {
  AlbumRow,
  ArtistRow,
  FolderRow,
  GenreRow,
  PlaylistRow,
  SongRow,
} from "@/library/LibraryStore";
import {
  confirmDeletePlaylist,
  openAddToPlaylist,
  renamePlaylistFlow,
} from "@/library/PlaylistSheets";
import { removePlaylistItem } from "@/library/playlists";
import { openAlbum, openArtist } from "@/library/routes";
import { itemSongs, librarySectionSongs } from "@/library/sectionSongs";
import { pressedRect } from "@/motion/pressedRect";
import { showError } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";
import { useSlideToChoose } from "@/overlay/useSlideToChoose";

import { addToQueue, playNext } from "./actions";

/** A track's place in the playlist its menu was opened from. */
export interface PlaylistPlace {
  readonly playlistId: number;
  readonly itemId: number;
}

/** What a long-press menu is about. */
export type ActionTarget =
  | {
      readonly kind: "track";
      readonly song: SongRow;
      /** Set when opened from a playlist: offers Remove from Playlist. */
      readonly playlistItem?: PlaylistPlace | undefined;
    }
  | { readonly kind: "album"; readonly album: AlbumRow }
  | { readonly kind: "artist"; readonly artist: ArtistRow }
  | { readonly kind: "playlist"; readonly playlist: PlaylistRow }
  | { readonly kind: "genre"; readonly genre: GenreRow }
  | { readonly kind: "folder"; readonly folder: FolderRow }
  | { readonly kind: "section"; readonly section: LibrarySection };

type TargetOf<K extends ActionTarget["kind"]> = Extract<ActionTarget, { kind: K }>;

interface Heading {
  readonly title: string;
  readonly subtitle: string;
  /** Artwork beside the title; undefined for a text-only heading. */
  readonly covers: readonly string[] | undefined;
}

/** What a menu needs to know about one kind of target. */
interface TargetKind<T extends ActionTarget> {
  /** The tracks its queue actions act on, in play order. */
  readonly songs: (target: T) => Promise<readonly SongRow[]>;
  /** What the menu says it's about; `sectionSongs` counts each Library entry's songs, once known. */
  readonly heading: (target: T, sectionSongs: LibraryCounts | undefined) => Heading;
  /** Where Go to Album / Go to Artist lead; neither when absent. */
  readonly goesTo?: (target: T) => { readonly albumId?: number; readonly artistId?: number };
}

const plural = (count: number, word: string): string =>
  `${count.toLocaleString("en")} ${count === 1 ? word : `${word}s`}`;

const cover = (thumbPath: string | null): readonly string[] =>
  thumbPath === null ? [] : [thumbPath];

const KINDS: { readonly [K in ActionTarget["kind"]]: TargetKind<TargetOf<K>> } = {
  track: {
    songs: ({ song }) => Promise.resolve([song]),
    heading: ({ song }) => ({
      title: song.title,
      subtitle: song.artist,
      covers: cover(song.thumbPath),
    }),
    goesTo: ({ song }) => ({ albumId: song.albumId, artistId: song.artistId }),
  },
  album: {
    songs: ({ album }) => itemSongs("albums", album.id),
    heading: ({ album }) => ({
      title: album.title,
      subtitle: album.albumArtist,
      covers: cover(album.thumbPath),
    }),
    goesTo: ({ album }) => ({ artistId: album.albumArtistId }),
  },
  // Artists, genres and folders have no picture; their headings are text only.
  artist: {
    songs: ({ artist }) => itemSongs("artists", artist.id),
    heading: ({ artist }) => ({
      title: artist.name,
      subtitle: plural(artist.trackCount, "song"),
      covers: undefined,
    }),
  },
  playlist: {
    songs: ({ playlist }) => itemSongs("playlists", playlist.id),
    heading: ({ playlist }) => ({
      title: playlist.name,
      subtitle: plural(playlist.trackCount, "song"),
      covers: playlist.thumbPaths,
    }),
  },
  genre: {
    songs: ({ genre }) => itemSongs("genres", genre.id),
    heading: ({ genre }) => ({
      title: genre.name,
      subtitle: plural(genre.trackCount, "song"),
      covers: undefined,
    }),
  },
  folder: {
    songs: ({ folder }) => itemSongs("folders", folder.id),
    heading: ({ folder }) => ({
      title: folder.name,
      subtitle: plural(folder.trackCount, "song"),
      covers: undefined,
    }),
  },
  section: {
    songs: ({ section }) => librarySectionSongs(section.slug),
    heading: ({ section }, sectionSongs) => {
      const count = sectionSongs?.[section.slug];
      return {
        title: section.label,
        subtitle: count === undefined ? "" : plural(count, "song"),
        covers: undefined,
      };
    },
  },
};

const kindOf = <T extends ActionTarget>(target: T): TargetKind<T> =>
  KINDS[target.kind] as unknown as TargetKind<T>;

/** The tracks a menu's queue actions act on, in play order. */
export const targetSongs = (target: ActionTarget): Promise<readonly SongRow[]> =>
  kindOf(target).songs(target);

/**
 * Floats the menu next to the row (or button) whose press opened it, centred
 * when opened some other way.
 */
const openActions = (target: ActionTarget): void => {
  openOverlay({
    label: kindOf(target).heading(target, undefined).title,
    anchor: pressedRect(),
    render: (close) => <ActionsMenu target={target} close={close} />,
  });
};

/** Opens the long-press menu for a track (in a playlist, pass its place there). */
export const openTrackActions = (song: SongRow, playlistItem?: PlaylistPlace): void =>
  openActions({ kind: "track", song, playlistItem });

/** Opens the menu for a playlist: queue it, add it to another, rename or delete it. */
export const openPlaylistActions = (playlist: PlaylistRow): void =>
  openActions({ kind: "playlist", playlist });

/** Opens the long-press menu for an album (Play Next and Add to Queue take the whole album). */
export const openAlbumActions = (album: AlbumRow): void => openActions({ kind: "album", album });

/** Opens the long-press menu for an artist (their songs, in the artist screen's order). */
export const openArtistActions = (artist: ArtistRow): void =>
  openActions({ kind: "artist", artist });

/** Opens the long-press menu for a genre (its songs, in the genre screen's order). */
export const openGenreActions = (genre: GenreRow): void => openActions({ kind: "genre", genre });

/** Opens the long-press menu for a folder (its songs, in the folder screen's order). */
export const openFolderActions = (folder: FolderRow): void =>
  openActions({ kind: "folder", folder });

/** Opens the menu for a Library entry (Songs, Albums…): every song it holds, in its order. */
export const openLibrarySectionActions = (section: LibrarySection): void =>
  openActions({ kind: "section", section });

/** One line of the menu. */
interface MenuEntry {
  readonly label: string;
  readonly onPress: () => void;
  /** Deletes something for good: shown in the destructive colour. */
  readonly destructive?: boolean;
}

/**
 * The long-press menu for a track, an album, an artist, a playlist, a genre, a
 * folder or a Library entry: what it is, then one quiet line per action. A
 * glass card on the overlay, floating next to the row it was opened from.
 */
function ActionsMenu({ target, close }: { target: ActionTarget; close: () => void }) {
  const pathname = usePathname();
  // Only a Library entry's heading needs these; the count is one cheap query.
  const sectionSongs = useSectionSongCounts();
  const song = target.kind === "track" ? target.song : null;
  // Stars stay in sync everywhere.
  const favorite = useIsFavorite(song?.id ?? null);

  const queue = (action: (songs: readonly SongRow[]) => void) => () => {
    targetSongs(target)
      .then(action)
      .catch((error: unknown) => showError("Couldn't load the songs", error));
    close();
  };

  const go = (open: () => void) => () => {
    close();
    open();
  };

  const kind = kindOf(target);
  const head = kind.heading(target, sectionSongs);
  const { albumId, artistId } = kind.goesTo?.(target) ?? {};
  const place = target.kind === "track" ? target.playlistItem : undefined;

  const entries: readonly MenuEntry[] = [
    { label: "Play Next", onPress: queue(playNext) },
    { label: "Add to Queue", onPress: queue(addToQueue) },
    {
      label: "Add to Playlist",
      onPress: go(() => openAddToPlaylist({ title: head.title, songs: () => targetSongs(target) })),
    },
    ...(song === null
      ? []
      : [
          {
            label: favorite ? "Remove from Favorites" : "Favorite",
            onPress: () => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void setFavorite(song.id, !favorite);
              close();
            },
          },
        ]),
    ...(place === undefined
      ? []
      : [
          {
            label: "Remove from Playlist",
            onPress: go(() => void removePlaylistItem(place.playlistId, place.itemId)),
          },
        ]),
    ...(albumId === undefined || isDetailPath(pathname, "album", albumId)
      ? []
      : [{ label: "Go to Album", onPress: go(() => openAlbum(albumId)) }]),
    ...(artistId === undefined || isDetailPath(pathname, "artist", artistId)
      ? []
      : [{ label: "Go to Artist", onPress: go(() => openArtist(artistId)) }]),
    ...(target.kind === "playlist"
      ? [
          {
            label: "Rename Playlist",
            onPress: go(() => void renamePlaylistFlow(target.playlist)),
          },
          {
            label: "Delete Playlist",
            onPress: go(() =>
              confirmDeletePlaylist(target.playlist, () => {
                // Leave the playlist's screen once it's gone.
                if (isDetailPath(pathname, "playlist", target.playlist.id)) router.back();
              }),
            ),
          },
        ]
      : []),
    // Last, and destructive: deletes the song's file from the phone (after asking).
    ...(song === null
      ? []
      : [
          {
            label: "Delete",
            destructive: true,
            onPress: go(() => void confirmDeleteSongs([song])),
          },
        ]),
  ];

  // The finger that long-pressed the row can slide onto an entry and lift to run it;
  // the entry under it shows pressed meanwhile.
  const { underFinger, trackEntry, trackList } = useSlideToChoose((index) =>
    entries[index]?.onPress(),
  );
  const flow = useOverlayFlow();

  return (
    <>
      <View
        className="flex-row items-center"
        style={{ paddingBottom: CELL * 1.5, gap: CELL * 1.5 }}
      >
        {head.covers !== undefined && <Mosaic paths={head.covers} size={CELL * 5} />}
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {head.title}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {head.subtitle}
          </Text>
        </View>
      </View>
      <Hairline />
      {/* Play Next sits nearest the finger, whichever side of the row the card opened on. */}
      <CardEntries listRef={trackList}>
        {entries.map((entry, index) => (
          <View key={entry.label} ref={trackEntry(index)} collapsable={false}>
            <EntryRow
              label={entry.label}
              onPress={entry.onPress}
              divider={entryDivider(index, entries.length, flow)}
              highlighted={index === underFinger}
              destructive={entry.destructive}
            />
          </View>
        ))}
      </CardEntries>
    </>
  );
}
