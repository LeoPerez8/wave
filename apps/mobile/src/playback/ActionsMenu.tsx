import { entryDivider } from "@wave/core";
import { Text, View } from "react-native";

import { ArtistImage } from "@/catalog/ArtistImage";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { Mosaic } from "@/catalog/Mosaic";
import type { LibrarySection } from "@/catalog/sections";
import type { LibraryCounts } from "@/library/db/counts";
import { useSectionSongCounts } from "@/library/hooks";
import type {
  AlbumRow,
  ArtistRow,
  FolderRow,
  GenreRow,
  PlaylistRow,
  SongRow,
} from "@/library/LibraryStore";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";
import { useSlideToChoose } from "@/overlay/useSlideToChoose";

import { targetHeading, type ActionItems, type PlaylistPlace } from "./actionTargets";
import { useItemActions } from "./itemActions";

/** How a menu was opened. */
export interface MenuOptions {
  /** The list it was opened from can select: the menu offers Select, which calls this. */
  readonly onSelect?: (() => void) | undefined;
}

/**
 * Floats the menu next to the row (or button) whose press opened it, centred
 * when opened some other way.
 */
const openActions = (target: ActionItems, options: MenuOptions = {}): void => {
  openOverlay({
    label: targetHeading(target, undefined)?.title ?? "Actions",
    anchor: pressedRect(),
    render: (close) =>
      target.kind === "section" ? (
        <SectionActionsMenu target={target} close={close} />
      ) : (
        <ActionsMenu target={target} close={close} onSelect={options.onSelect} />
      ),
  });
};

/** Opens the long-press menu for a track (in a playlist, pass its place there). */
export const openTrackActions = (
  song: SongRow,
  options: MenuOptions & { readonly playlistItem?: PlaylistPlace | undefined } = {},
): void =>
  openActions({ kind: "track", items: [{ song, playlistItem: options.playlistItem }] }, options);

/** Opens the menu for a playlist: queue it, add it to another, rename or delete it. */
export const openPlaylistActions = (playlist: PlaylistRow, options?: MenuOptions): void =>
  openActions({ kind: "playlist", items: [playlist] }, options);

/** Opens the long-press menu for an album (Play Next and Add to Queue take the whole album). */
export const openAlbumActions = (album: AlbumRow, options?: MenuOptions): void =>
  openActions({ kind: "album", items: [album] }, options);

/** Opens the long-press menu for an artist (their songs, in the artist screen's order). */
export const openArtistActions = (artist: ArtistRow, options?: MenuOptions): void =>
  openActions({ kind: "artist", items: [artist] }, options);

/** Opens the long-press menu for a genre (its songs, in the genre screen's order). */
export const openGenreActions = (genre: GenreRow, options?: MenuOptions): void =>
  openActions({ kind: "genre", items: [genre] }, options);

/** Opens the long-press menu for a folder (its songs, in the folder screen's order). */
export const openFolderActions = (folder: FolderRow, options?: MenuOptions): void =>
  openActions({ kind: "folder", items: [folder] }, options);

/** Opens the menu for a Library entry (Songs, Albums…): every song it holds, in its order. */
export const openLibrarySectionActions = (section: LibrarySection): void =>
  openActions({ kind: "section", items: [section] });

/** A Library entry's menu, which says how many songs it acts on: the only menu that counts. */
function SectionActionsMenu({ target, close }: { target: ActionItems; close: () => void }) {
  const sectionSongs = useSectionSongCounts();
  return (
    <ActionsMenu target={target} close={close} onSelect={undefined} sectionSongs={sectionSongs} />
  );
}

/**
 * The long-press menu for a track, an album, an artist, a playlist, a genre, a
 * folder or a Library entry: what it is, then one quiet line per action (the
 * shared list in `itemActions`, which the selection bar offers too). A glass
 * card on the overlay, floating next to the row it was opened from.
 */
function ActionsMenu({
  target,
  close,
  onSelect,
  sectionSongs,
}: {
  target: ActionItems;
  close: () => void;
  onSelect: (() => void) | undefined;
  /** Each Library entry's song count, for a Library entry's heading (`SectionActionsMenu`). */
  sectionSongs?: LibraryCounts | undefined;
}) {
  const head = targetHeading(target, sectionSongs);
  const entries = useItemActions(target, { surface: "menu", finish: close, onSelect });

  // The finger that long-pressed the row can slide onto an entry and lift to run it;
  // the entry under it shows pressed meanwhile.
  const { underFinger, trackEntry, trackList } = useSlideToChoose((index) =>
    entries[index]?.onPress(),
  );
  const flow = useOverlayFlow();

  return (
    <>
      {head !== undefined && (
        <View
          className="flex-row items-center"
          style={{ paddingBottom: CELL * 1.5, gap: CELL * 1.5 }}
        >
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
        </View>
      )}
      <Hairline />
      {/* Play Next sits nearest the finger, whichever side of the row the card opened on. */}
      <CardEntries listRef={trackList}>
        {entries.map((entry, index) => (
          <View key={entry.action} ref={trackEntry(index)} collapsable={false}>
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
