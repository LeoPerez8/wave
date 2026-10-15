import {
  defaultSongSort,
  playlistImportSources,
  songSortsFor,
  type DesignPreviewState,
} from "@wave/core";
import { useRef, type ComponentRef, type ReactNode } from "react";
import { View } from "react-native";

import type { AlbumSummary } from "@/catalog/AlbumTile";
import { openSourceMenu } from "@/library/importPlaylistLink";
import type { AlbumRow, SongRow } from "@/library/LibraryStore";
import { promptNewPlaylist } from "@/library/PlaylistSheets";
import type { PlaylistsControl } from "@/library/PlaylistsList";
import { openSortMenu } from "@/library/SongSortButton";
import { measureRect } from "@/motion/measureRect";
import { runPressedAt } from "@/motion/pressedRect";
import { ItemMenuCard, openItemCard } from "@/playback/ActionsMenu";
import type { ActionItems } from "@/playback/actionTargets";
import { actionEntries, usePlannedActions } from "@/playback/itemActions";

import {
  LONG_TITLE_TRACK_ID,
  SYNTHETIC_ALBUMS,
  SYNTHETIC_PLAYLISTS,
  SYNTHETIC_TRACKS,
  type SyntheticTrack,
} from "./syntheticLibrary";

/** The Design preview's shelves. */
export type Shelf = "albums" | "songs" | "playlists";

/** A control on a shelf that opens a card: the Songs' Sort, the Playlists' Import and New. */
export type Control = "sort" | PlaylistsControl;

/**
 * A state the Design preview opens straight into from
 * `wave://design-preview?state=<name>` (Core's `designPreviewState`).
 */
export interface PreviewState extends DesignPreviewState {
  /** The shelf it shows. */
  readonly shelf: Shelf;
  /** What on that shelf opens the card: an item (its index) or a control. */
  readonly from: number | Control;
  /** Opens the card, as a press on [from] would: [from] is the pressed one. */
  readonly open: () => void;
}

/** Where the long-titled song sits in the synthetic Songs. */
const LONG_TITLE = SYNTHETIC_TRACKS.findIndex(({ track }) => track.id === LONG_TITLE_TRACK_ID);

/**
 * Every state, by name: the one list of them. Add one here: a name, a line on
 * what it shows, the shelf, what opens the card, and how to open it.
 */
export const PREVIEW_STATES: readonly PreviewState[] = [
  {
    name: "song-card-open",
    shows: "A song's card open over its row, as a long press opens it: the row highlighted.",
    shelf: "songs",
    // A plain row: not the playing one, not a missing one, not a favorite.
    from: 3,
    open: () => openSongCard(SYNTHETIC_TRACKS[3] as SyntheticTrack),
  },
  {
    name: "song-card-open-long-title",
    shows:
      "A song's card open over a row whose title is too long for it and truncates: the row highlighted, its artwork inside the tint.",
    shelf: "songs",
    from: LONG_TITLE,
    open: () => openSongCard(SYNTHETIC_TRACKS[LONG_TITLE] as SyntheticTrack),
  },
  {
    name: "album-card-open",
    shows: "An album's card open over its tile, as a long press opens it: the tile highlighted.",
    shelf: "albums",
    from: 0,
    open: () => openAlbumCard(SYNTHETIC_ALBUMS[0] as AlbumSummary),
  },
  {
    name: "sort-card-open",
    shows: "The Sort card of a song list open under the Sort button: the button highlighted.",
    shelf: "songs",
    from: "sort",
    open: () => openSortCard(),
  },
  {
    name: "import-playlists-card-open",
    shows:
      "The Import card (From a Link, From Files) open under Library › Playlists' Import Playlists: the button highlighted.",
    shelf: "playlists",
    from: "importPlaylists",
    open: () => openImportCard(),
  },
  {
    name: "new-playlist-prompt-open",
    shows:
      "New Playlist's name prompt, opened from Library › Playlists' New Playlist: the button highlighted, the keyboard up.",
    shelf: "playlists",
    from: "newPlaylist",
    open: () => openNewPlaylistPrompt(),
  },
];

// ---------------------------------------------------------------------------
// The cards, opened by the openers the real controls use, with choices and
// entries that only close them, so nothing reads or changes the Library.

/** The card a long press on a Library song opens, for a synthetic song. */
export const openSongCard = (item: SyntheticTrack): void => {
  const song = songRow(item);
  const target: ActionItems = { kind: "track", items: [{ song }] };
  const favorites = new Set(item.favorite ? [song.id] : []);
  openItemCard(target, (close) => (
    <PreviewItemMenu target={target} favorites={favorites} close={close} />
  ));
};

/** The card a long press on a Library album opens, for a synthetic album. */
export const openAlbumCard = (album: AlbumSummary): void => {
  const target: ActionItems = { kind: "album", items: [albumRow(album)] };
  openItemCard(target, (close) => (
    <PreviewItemMenu target={target} favorites={NO_FAVORITES} close={close} />
  ));
};

/** The Sort card of the Songs list, its default sort (the synthetic Songs' order) checked. */
export const openSortCard = (): void =>
  openSortMenu(songSortsFor("songs"), defaultSongSort("songs"), () => undefined);

/** The Import card Import Playlists opens with YT Music on (with it off there is no card). */
export const openImportCard = (): void =>
  openSourceMenu(playlistImportSources({ ytMusic: true }), () => undefined);

/** New Playlist's name prompt, the synthetic playlists' names taken; the name is dropped. */
export const openNewPlaylistPrompt = (): void => {
  void promptNewPlaylist(
    () => Promise.resolve(SYNTHETIC_PLAYLISTS.map((playlist) => playlist.name)),
    () => Promise.resolve(null),
  );
};

const NO_FAVORITES: ReadonlySet<number> = new Set();

/**
 * A Library item's long-press card for [target], as `ActionsMenu` draws it:
 * the entries the app plans for it, each only closing the card. [favorites]
 * stands in for the Library's stars.
 */
function PreviewItemMenu({
  target,
  favorites,
  close,
}: {
  target: ActionItems;
  favorites: ReadonlySet<number>;
  close: () => void;
}) {
  // The Library's Songs and Albums can select, so their menus offer Select.
  const planned = usePlannedActions(target, favorites, { surface: "menu", selectable: true });
  return <ItemMenuCard target={target} actions={actionEntries(planned, () => close)} />;
}

// Synthetic album and artist ids: Go to Album and Go to Artist show, and go nowhere.
const SYNTHETIC_ID = 1;

/** [item] as a Library song (no artwork, like the synthetic rows). */
const songRow = (item: SyntheticTrack): SongRow => {
  const { track } = item;
  return {
    id: SYNTHETIC_TRACKS.indexOf(item) + 1,
    path: "",
    title: track.title,
    artist: track.artist,
    album: "",
    durationMs: track.durationMs ?? 0,
    thumbPath: null,
    artworkPath: null,
    titleSort: track.title,
    artistSort: track.artist,
    albumSort: "",
    addedAt: 0,
    albumId: SYNTHETIC_ID,
    artistId: SYNTHETIC_ID,
    artistIds: [SYNTHETIC_ID],
    discNumber: null,
    trackNumber: track.trackNumber ?? null,
    year: null,
  };
};

/** [album] as a Library album (no artwork, like the synthetic tiles). */
const albumRow = (album: AlbumSummary): AlbumRow => ({
  id: SYNTHETIC_ALBUMS.indexOf(album) + 1,
  title: album.title,
  titleSort: album.title,
  albumArtist: album.albumArtist,
  albumArtistId: SYNTHETIC_ID,
  albumArtistIds: [SYNTHETIC_ID],
  year: album.year ?? null,
  compilation: false,
  trackCount: album.trackCount,
  durationMs: album.durationMs,
  thumbPath: null,
  artworkPath: null,
});

/**
 * Wraps what a state opens its card from. Once it is laid out, opens [open]
 * there, measured as a press measures its row or button, so the overlay
 * floats the card next to it and highlights it. Opens once.
 */
export function StateAnchor({
  open,
  children,
}: {
  open: (() => void) | undefined;
  children: ReactNode;
}) {
  const view = useRef<ComponentRef<typeof View>>(null);
  const opened = useRef(false);
  const onLayout = () => {
    if (open === undefined || opened.current) return;
    opened.current = true;
    void measureRect(view.current).then((rect) => runPressedAt(rect, open));
  };
  return (
    <View ref={view} collapsable={false} onLayout={onLayout}>
      {children}
    </View>
  );
}
