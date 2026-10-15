import { YT_PLAYLIST_DOWNLOAD_ACTION_LABELS, entryDivider } from "@wave/core";
import { Text, View } from "react-native";

import { ArtistImage } from "@/catalog/ArtistImage";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Mosaic } from "@/catalog/Mosaic";
import type { LibrarySection } from "@/catalog/sections";
import type { LibraryCounts } from "@/library/db/counts";
import { useSectionSongCounts } from "@/library/hooks";
import type {
  AlbumRow,
  ArtistRow,
  GenreRow,
  PlaylistEntryRow,
  PlaylistRow,
  SongRow,
} from "@/library/LibraryStore";
import { playlistEntries } from "@/library/sectionSongs";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { CardHeading } from "@/overlay/CardHeading";
import { useOverlayFlow } from "@/overlay/flow";
import { followUp, openOverlay } from "@/overlay/overlay";
import { useSlideToChoose } from "@/overlay/useSlideToChoose";
import { useLoadedInLibrary } from "@/ytmusic/libraryFinder";
import { playlistYtSongs, runYtDownloadAction, useYtPlaylistDownload } from "@/ytmusic/YtDownloads";

import { targetHeading, type ActionItems, type Heading, type PlaylistPlace } from "./actionTargets";
import { useItemActions } from "./itemActions";

const NO_ENTRIES: readonly PlaylistEntryRow[] = [];

/** How a menu was opened. */
export interface MenuOptions {
  /** The list it was opened from can select: the menu offers Select, which calls this. */
  readonly onSelect?: (() => void) | undefined;
}

/**
 * Floats the menu next to the row (or button) whose press opened it ([anchor],
 * taken at the press), centred when opened some other way. A playlist's menu
 * is given its [entries], for its download entries.
 */
const openActions = (
  target: ActionItems,
  options: MenuOptions = {},
  anchor = pressedRect(),
  entries: readonly PlaylistEntryRow[] = NO_ENTRIES,
): void => {
  openOverlay({
    label: targetHeading(target, undefined)?.title ?? "Actions",
    anchor,
    render: (close) =>
      target.kind === "section" ? (
        <SectionActionsMenu target={target} close={close} />
      ) : (
        <ActionsMenu
          target={target}
          close={close}
          onSelect={options.onSelect}
          playlistEntries={entries}
        />
      ),
  });
};

/** Opens the long-press menu for a track (in a playlist, pass its place there). */
export const openTrackActions = (
  song: SongRow,
  options: MenuOptions & { readonly playlistItem?: PlaylistPlace | undefined } = {},
): void =>
  openActions({ kind: "track", items: [{ song, playlistItem: options.playlistItem }] }, options);

/**
 * Opens the menu for a playlist: queue it, add it to another, download its YT
 * Music entries (Core's `ytPlaylistDownload`), rename or delete it. Its
 * entries are read first, so the card opens with every entry it will have.
 */
export const openPlaylistActions = (playlist: PlaylistRow, options?: MenuOptions): void => {
  const anchor = pressedRect();
  void followUp(async () => {
    const entries = await playlistEntries(playlist.id).catch(() => NO_ENTRIES);
    openActions({ kind: "playlist", items: [playlist] }, options, anchor, entries);
  });
};

/** Opens the long-press menu for an album (Play Next and Add to Queue take the whole album). */
export const openAlbumActions = (album: AlbumRow, options?: MenuOptions): void =>
  openActions({ kind: "album", items: [album] }, options);

/** Opens the long-press menu for an artist (their songs, in the artist screen's order). */
export const openArtistActions = (artist: ArtistRow, options?: MenuOptions): void =>
  openActions({ kind: "artist", items: [artist] }, options);

/** Opens the long-press menu for a genre (its songs, in the genre screen's order). */
export const openGenreActions = (genre: GenreRow, options?: MenuOptions): void =>
  openActions({ kind: "genre", items: [genre] }, options);

/** Opens the menu for a Library entry (Songs, Albums…): every song it holds, in its order. */
export const openLibrarySectionActions = (section: LibrarySection): void =>
  openActions({ kind: "section", items: [section] });

/** A Library entry's menu, which says how many songs it acts on: the only menu that counts. */
function SectionActionsMenu({ target, close }: { target: ActionItems; close: () => void }) {
  const sectionSongs = useSectionSongCounts();
  return (
    <ActionsMenu
      target={target}
      close={close}
      onSelect={undefined}
      sectionSongs={sectionSongs}
      playlistEntries={NO_ENTRIES}
    />
  );
}

/** One row of the menu card. */
export interface MenuEntry {
  readonly key: string;
  readonly label: string;
  readonly onPress: () => void;
  readonly destructive: boolean;
}

/**
 * A playlist's download entries (Core's `ytPlaylistDownload`): Download
 * Playlist, or Cancel Playlist Download while its songs are on their way,
 * then Retry Failed; none without YT Music entries.
 */
function usePlaylistDownloadEntries(
  entries: readonly PlaylistEntryRow[],
  close: () => void,
): MenuEntry[] {
  const inLibrary = useLoadedInLibrary();
  const download = useYtPlaylistDownload(entries, inLibrary);
  return download.actions.map((action) => ({
    key: action,
    label: YT_PLAYLIST_DOWNLOAD_ACTION_LABELS[action],
    onPress: () => {
      close();
      runYtDownloadAction(action, playlistYtSongs(entries), inLibrary);
    },
    destructive: false,
  }));
}

/**
 * The long-press menu for a track, an album, an artist, a playlist, a genre or
 * a Library entry: what it is (unless the row it was opened from is
 * highlighted, which says so already), then one quiet line per action (the
 * shared list in `itemActions`, which the selection bar offers too). A glass
 * card on the overlay, floating next to the row it was opened from.
 */
function ActionsMenu({
  target,
  close,
  onSelect,
  sectionSongs,
  playlistEntries: listed,
}: {
  target: ActionItems;
  close: () => void;
  onSelect: (() => void) | undefined;
  /** Each Library entry's song count, for a Library entry's heading (`SectionActionsMenu`). */
  sectionSongs?: LibraryCounts | undefined;
  /** A playlist's entries, for its download entries; none for other targets. */
  playlistEntries: readonly PlaylistEntryRow[];
}) {
  const actions = useItemActions(target, { surface: "menu", finish: close, onSelect });
  const downloads = usePlaylistDownloadEntries(listed, close);
  // A playlist's download entries follow Add to Playlist, before Rename and Delete.
  const entries: MenuEntry[] = actions.flatMap((entry): MenuEntry[] => [
    { key: entry.action, ...entry },
    ...(entry.action === "addToPlaylist" ? downloads : []),
  ]);

  return (
    <MenuCard
      heading={targetHeading(target, sectionSongs)}
      // A Library entry's heading counts the songs it acts on, which its row doesn't show.
      alwaysHeading={target.kind === "section"}
      entries={entries}
    />
  );
}

/**
 * What a menu card draws: its heading (unless the row it was opened from is
 * highlighted), then its entries. The Design preview draws it too, with
 * entries that only close it.
 */
export function MenuCard({
  heading: head,
  alwaysHeading = false,
  entries,
}: {
  heading: Heading | undefined;
  /** Shows the heading even under a highlight (`CardHeading`'s `always`). */
  alwaysHeading?: boolean;
  entries: readonly MenuEntry[];
}) {
  // The finger that long-pressed the row can slide onto an entry and lift to run it;
  // the entry under it shows pressed meanwhile.
  const { underFinger, trackEntry, trackList } = useSlideToChoose((index) =>
    entries[index]?.onPress(),
  );
  const flow = useOverlayFlow();

  return (
    <>
      {head !== undefined && (
        <CardHeading always={alwaysHeading}>
          {head.covers !== undefined && <Mosaic paths={head.covers} size={CELL * 5} />}
          {head.artist !== undefined && <ArtistImage artist={head.artist} size={CELL * 5} />}
          <View className="flex-1">
            <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
              {head.title}
            </Text>
            <Text numberOfLines={1} className="font-sans text-body text-secondary">
              {head.subtitle}
            </Text>
          </View>
        </CardHeading>
      )}
      {/* Play Next sits nearest the finger, whichever side of the row the card opened on. */}
      <CardEntries listRef={trackList}>
        {entries.map((entry, index) => (
          <View key={entry.key} ref={trackEntry(index)} collapsable={false}>
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
