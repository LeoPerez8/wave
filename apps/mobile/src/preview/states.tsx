import {
  defaultSongSort,
  ITEM_ACTION_LABELS,
  isDestructiveAction,
  itemActions,
  playlistImportSources,
  songSortsFor,
  type ActionSubject,
  type DesignPreviewState,
} from "@wave/core";
import { usePathname } from "expo-router";
import { useRef, type ComponentRef, type ReactNode } from "react";
import { View } from "react-native";

import type { AlbumSummary } from "@/catalog/AlbumTile";
import { SourceMenu } from "@/library/importPlaylistLink";
import { askNewPlaylistName } from "@/library/PlaylistSheets";
import { SortMenu } from "@/library/SongSortButton";
import { measureRect } from "@/motion/measureRect";
import { pressedRect, runPressedAt } from "@/motion/pressedRect";
import { openOverlay } from "@/overlay/overlay";
import { MenuCard } from "@/playback/ActionsMenu";
import type { Heading } from "@/playback/actionTargets";
import { useLyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";

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
export type Control = "sort" | "importPlaylists" | "newPlaylist";

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

/** The first plain song: not the playing one, not a missing one, not a favorite, a short title. */
const PLAIN = SYNTHETIC_TRACKS.findIndex(
  ({ track, state, favorite }) =>
    state === undefined && !favorite && track.id !== LONG_TITLE_TRACK_ID,
);

/**
 * Every state, by name: the one list of them. Add one here: a name, a line on
 * what it shows, the shelf, what opens the card, and how to open it.
 */
export const PREVIEW_STATES: readonly PreviewState[] = [
  {
    name: "song-card-open",
    shows: "A song's card open over its row, as a long press opens it: the row highlighted.",
    shelf: "songs",
    from: PLAIN,
    open: () => openSongCard(SYNTHETIC_TRACKS[PLAIN] as SyntheticTrack),
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
// The cards, opened through the overlay as the real controls open them, each
// entry only closing its card, so nothing reads or changes the Library.

/** The card a long press on a Library song opens, for a synthetic song. */
export const openSongCard = ({ track, favorite }: SyntheticTrack): void =>
  openItemCard(
    { title: track.title, subtitle: track.artist, covers: [] },
    // Synthetic album and artist ids: Go to Album and Go to Artist show, and go nowhere.
    { kind: "track", items: [{ albumId: 1, artistIds: [1], favorite, inPlaylist: false }] },
  );

/** The card a long press on a Library album opens, for a synthetic album. */
export const openAlbumCard = (album: AlbumSummary): void =>
  openItemCard(
    { title: album.title, subtitle: album.albumArtist, covers: [] },
    // A synthetic artist id: Go to Artist shows, and goes nowhere.
    { kind: "album", items: [{ artistIds: [1] }] },
  );

/** The Sort card of the Songs list, its default sort (the synthetic Songs' order) checked. */
export const openSortCard = (): void => {
  openOverlay({
    label: "Sort by",
    anchor: pressedRect(),
    render: (close) => (
      <SortMenu sorts={songSortsFor("songs")} current={defaultSongSort("songs")} choose={close} />
    ),
  });
};

/** The Import card Import Playlists opens with YT Music on (with it off there is no card). */
export const openImportCard = (): void => {
  openOverlay({
    label: "Import",
    anchor: pressedRect(),
    render: (close) => (
      <SourceMenu sources={playlistImportSources({ ytMusic: true })} choose={close} />
    ),
  });
};

/** New Playlist's name prompt, the synthetic playlists' names taken; the name is dropped. */
export const openNewPlaylistPrompt = (): void => {
  void askNewPlaylistName(SYNTHETIC_PLAYLISTS.map((playlist) => playlist.name));
};

/** A Library item's long-press card, through the overlay: [heading], then the entries for [subject]. */
const openItemCard = (heading: Heading, subject: Pick<ActionSubject, "kind" | "items">): void => {
  openOverlay({
    label: heading.title,
    anchor: pressedRect(),
    render: (close) => <PreviewItemMenu heading={heading} subject={subject} close={close} />,
  });
};

function PreviewItemMenu({
  heading,
  subject,
  close,
}: {
  heading: Heading;
  subject: Pick<ActionSubject, "kind" | "items">;
  close: () => void;
}) {
  const here = usePathname();
  const onlineLookups = useLyricsAndGenreLookupsEnabled();
  const entries = itemActions({
    ...subject,
    surface: "menu",
    // The Library's Songs and Albums can select, so their menus offer Select.
    selectable: true,
    onlineLookups,
    here,
  }).map((entry) => ({
    key: entry.action,
    label: ITEM_ACTION_LABELS[entry.action],
    onPress: close,
    destructive: isDestructiveAction(entry.action),
  }));
  return <MenuCard heading={heading} entries={entries} />;
}

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
