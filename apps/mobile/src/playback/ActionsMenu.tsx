import { useFollow } from "@/library/follows";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { followMenuPress } from "@/library/FollowButton";
import {
  PLAY_ACTION_LABELS,
  YT_PLAYLIST_DOWNLOAD_ACTION_LABELS,
  currentEntry,
  menuLayout,
  type DownloadOrigin,
  type UnsearchedSong,
  isUnsearchedTrackId,
  playlistDownloadOrigin,
} from "@wave/core";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { ArtistImage } from "@/catalog/ArtistImage";
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
import { playlistEntries, songsWithIds } from "@/library/sectionSongs";
import { pressedMenuAllowed, pressedRect } from "@/motion/pressedRect";
import { CardHeading } from "@/overlay/CardHeading";
import { MenuChoices, type MenuChoice, type PlayCardChoice } from "@/overlay/MenuChoices";
import { followUp, openOverlay } from "@/overlay/overlay";
import { openYtSongActions } from "@/ytmusic/YtSongActions";
import { useLoadedInLibrary } from "@/ytmusic/libraryFinder";
import { runYtPlaylistDownloadAction, useYtPlaylistDownload } from "@/ytmusic/YtDownloads";

import { targetHeading, type ActionItems, type Heading, type PlaylistPlace } from "./actionTargets";
import { readMenuSongs, useItemActions, type ActionEntry } from "./itemActions";
import { queueState } from "./Queue";
import { playTarget } from "./playTarget";
import { queueTracks } from "./queueTracks";
import { songMenuTarget } from "./songMenuTarget";

const NO_ENTRIES: readonly PlaylistEntryRow[] = [];
const NO_SONGS: readonly SongRow[] = [];
const NO_DOWNLOADS: readonly MenuChoice[] = [];

/** How a menu was opened. */
export interface MenuOptions {
  readonly extraEntries?: readonly MenuChoice[] | undefined;
  /** The list it was opened from can select: the menu offers Select, which calls this. */
  readonly onSelect?: (() => void) | undefined;
  /** The song is the one playing (the mini player's long press): no Play Next or Add to Queue. */
  readonly playing?: boolean | undefined;
}

/**
 * Floats [target]'s card, drawn by [render], next to the row (or button) whose
 * press opened it ([anchor], taken at the press), centred when opened some
 * other way. The Design preview opens its menus with it too.
 */
export const openItemCard = (
  target: ActionItems,
  render: (close: () => void) => ReactNode,
  anchor = pressedRect(),
): void => {
  openOverlay({
    label:
      targetHeading(target, undefined)?.title ?? currentLocalisation().strings.playbackText.actions,
    anchor,
    render,
  });
};

/**
 * Opens [target]'s menu. A playlist's menu is given its [entries], for its
 * download entries, and a collection's its [songs], for Fix Songs.
 */
const openActions = (
  target: ActionItems,
  options: MenuOptions = {},
  anchor = pressedRect(),
  entries: readonly PlaylistEntryRow[] = NO_ENTRIES,
  songs?: readonly SongRow[],
): void =>
  openItemCard(
    target,
    (close) =>
      target.kind === "section" ? (
        <SectionActionsMenu target={target} close={close} />
      ) : (
        <ActionsMenu
          target={target}
          close={close}
          extraEntries={options.extraEntries}
          onSelect={options.onSelect}
          playing={options.playing}
          playlistEntries={entries}
          collectionSongs={songs}
        />
      ),
    anchor,
  );

/**
 * Opens the menu for an album, artist or genre once its songs are read
 * (`readMenuSongs`), so the card opens with every entry it will have.
 */
const openCollectionActions = (target: ActionItems, options?: MenuOptions): void => {
  const anchor = pressedRect();
  const allowed = pressedMenuAllowed();
  void followUp(async () => {
    const songs = await readMenuSongs(target);
    if (!allowed()) return;
    openActions(target, options, anchor, NO_ENTRIES, songs);
  });
};

/** Opens the long-press menu for a track (in a playlist, pass its place there). */
export const openTrackActions = (
  song: SongRow,
  options: MenuOptions & { readonly playlistItem?: PlaylistPlace | undefined } = {},
): void =>
  openActions({ kind: "track", items: [{ song, playlistItem: options.playlistItem }] }, options);

/**
 * Opens the long-press menu for a playlist's unsearched entry: what a YT
 * Music entry's offers that needs no video (Play Next, Add to Queue, Add to
 * Playlist, Remove from Playlist, Go to Artist, Select).
 */
export const openUnsearchedActions = (
  song: UnsearchedSong,
  options: MenuOptions & { readonly playlistItem?: PlaylistPlace | undefined } = {},
): void =>
  openActions(
    { kind: "track", items: [{ unsearched: song, playlistItem: options.playlistItem }] },
    options,
  );

/**
 * Opens the long-press menu for the Library song [id], reading its row first:
 * a paged list (Library › Songs) holds only what its rows show.
 */
export const openTrackActionsById = (id: number, options: MenuOptions = {}): void => {
  const anchor = pressedRect();
  const allowed = pressedMenuAllowed();
  void followUp(async () => {
    const [song] = await songsWithIds([id]).catch(() => NO_SONGS);
    if (!allowed()) return;
    if (song !== undefined) openActions({ kind: "track", items: [{ song }] }, options, anchor);
  });
};

/**
 * Opens the usual menu for the queued song [trackId] (an Up Next or History
 * row's long press, `songMenuTarget`), as its row elsewhere offers it.
 */
export const openQueuedSongActions = (trackId: string, options: MenuOptions = {}): void => {
  const target = songMenuTarget(trackId, queueTracks.get().get(trackId));
  switch (target?.kind) {
    case "library":
      openTrackActionsById(target.id, options);
      break;
    case "stream":
      openYtSongActions(target.song, options);
      break;
    case "unsearched":
      openUnsearchedActions(target.song, options);
      break;
  }
};

/**
 * Opens the long-press menu for the song playing (the mini player's long
 * press): its own menu as a song's row offers it, without Play Next and Add to
 * Queue (Core's `itemActions`, `ytSongActions`). Nothing opens with no song on,
 * nor for an unsearched song while its search runs.
 */
export const openPlayingActions = (): void => {
  const trackId = currentEntry(queueState.get())?.trackId;
  if (trackId === undefined || isUnsearchedTrackId(trackId)) return;
  openQueuedSongActions(trackId, { playing: true });
};

/**
 * Opens the menu for a playlist: queue it, add it to another, download its YT
 * Music and unsearched entries (Core's `ytPlaylistDownload`), rename or delete it. Its
 * entries are read first, so the card opens with every entry it will have.
 */
export const openPlaylistActions = (playlist: PlaylistRow, options?: MenuOptions): void => {
  const anchor = pressedRect();
  const allowed = pressedMenuAllowed();
  const target: ActionItems = { kind: "playlist", items: [playlist] };
  void followUp(async () => {
    const [entries, songs] = await Promise.all([
      playlistEntries(playlist.id).catch(() => NO_ENTRIES),
      readMenuSongs(target),
    ]);
    if (!allowed()) return;
    openActions(target, options, anchor, entries, songs);
  });
};

/** Opens the long-press menu for an album (Play Next and Add to Queue take the whole album). */
export const openAlbumActions = (album: AlbumRow, options?: MenuOptions): void =>
  openCollectionActions({ kind: "album", items: [album] }, options);

/** Opens the long-press menu for an artist (their songs, in the artist screen's order). */
export const openArtistActions = (artist: ArtistRow, options?: MenuOptions): void =>
  openCollectionActions({ kind: "artist", items: [artist] }, options);

/** Opens the long-press menu for a genre (its songs, in the genre screen's order). */
export const openGenreActions = (genre: GenreRow, options?: MenuOptions): void =>
  openCollectionActions({ kind: "genre", items: [genre] }, options);

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

/**
 * A playlist's download entries (Core's `ytPlaylistDownload`): Download
 * Playlist, or Cancel Playlist Download while its songs are on their way,
 * then Retry Failed; none without YT Music or unsearched entries. The songs
 * they queue remember [origin], the playlist.
 */
function usePlaylistDownloadEntries(
  entries: readonly PlaylistEntryRow[],
  origin: DownloadOrigin | null,
  close: () => void,
): MenuChoice[] {
  const inLibrary = useLoadedInLibrary();
  const download = useYtPlaylistDownload(entries, inLibrary);
  return download.actions.map((action) => ({
    action,
    label: YT_PLAYLIST_DOWNLOAD_ACTION_LABELS[action],
    onPress: () => {
      close();
      runYtPlaylistDownloadAction(action, entries, inLibrary, origin);
    },
    destructive: false,
  }));
}

/**
 * The long-press menu for a track, an album, an artist, a playlist, a genre or
 * a Library entry: what it is (unless the row it was opened from is
 * highlighted, which says so already), then its play cards and one quiet
 * line per other action (the shared list in `itemActions`, which the
 * selection bar offers too). A glass card on the overlay, floating next to
 * the row it was opened from.
 */
function ActionsMenu({
  target,
  close,
  onSelect,
  sectionSongs,
  playlistEntries: listed,
  collectionSongs,
  playing,
  extraEntries = [],
}: {
  target: ActionItems;
  extraEntries?: readonly MenuChoice[] | undefined;
  close: () => void;
  onSelect: (() => void) | undefined;
  /** The song is the one playing: no Play Next or Add to Queue. */
  playing?: boolean | undefined;
  /** Each Library entry's song count, for a Library entry's heading (`SectionActionsMenu`). */
  sectionSongs?: LibraryCounts | undefined;
  /** A playlist's entries, for its download entries; none for other targets. */
  playlistEntries: readonly PlaylistEntryRow[];
  /** A collection's songs, read before it opened; none for other targets. */
  collectionSongs?: readonly SongRow[] | undefined;
}) {
  const actions = useItemActions(target, {
    surface: "menu",
    finish: close,
    onSelect,
    collectionSongs,
    playing,
  });
  const { strings } = useLocalisation();
  const artist = target.kind === "artist" ? target.items[0] : undefined;
  const follow = useFollow(artist?.name ?? "");
  const followEntries: readonly MenuChoice[] =
    artist === undefined
      ? []
      : [
          {
            action: "follow",
            label: follow === null ? strings.playbackText.follow : strings.playbackText.following,
            onPress: () => followMenuPress(artist, close),
          },
        ];
  const playlist = target.kind === "playlist" ? target.items[0] : undefined;
  const downloads = usePlaylistDownloadEntries(
    listed,
    playlist === undefined ? null : playlistDownloadOrigin(playlist),
    close,
  );
  return (
    <ItemMenuCard
      target={target}
      sectionSongs={sectionSongs}
      actions={actions}
      downloads={downloads}
      extraEntries={[
        ...followEntries,
        ...extraEntries.map((entry) => ({
          ...entry,
          onPress: () => {
            close();
            entry.onPress();
          },
        })),
      ]}
      play={(shuffle) => {
        close();
        playTarget(target, shuffle);
      }}
    />
  );
}

/**
 * [target]'s menu card: what it is, then its play cards and the rest of
 * [actions] under them (Core's `menuLayout`; a collection's Play and Shuffle
 * run [play]), a playlist's [downloads] after Add to Playlist. The Design
 * preview draws it too, for synthetic items, with actions that only close it.
 */
export function ItemMenuCard({
  target,
  sectionSongs,
  actions,
  downloads = NO_DOWNLOADS,
  extraEntries = NO_DOWNLOADS,
  play,
}: {
  target: ActionItems;
  /** Each Library entry's song count, for a Library entry's heading. */
  sectionSongs?: LibraryCounts | undefined;
  actions: readonly ActionEntry[];
  /** A playlist's download entries; none for other targets. */
  downloads?: readonly MenuChoice[];
  extraEntries?: readonly MenuChoice[];
  /** A collection's Play ([shuffle] false) and Shuffle: closes the menu and plays it. */
  play: (shuffle: boolean) => void;
}) {
  const layout = menuLayout(target.kind, actions);
  const cards = layout.cards.flatMap((card): PlayCardChoice[] => {
    if (card === "play") return [{ action: card, onPress: () => play(false) }];
    const entry = actions.find(({ action }) => action === card);
    return entry === undefined ? [] : [{ action: card, onPress: entry.onPress }];
  });
  // A playlist's download entries follow Add to Playlist, before Rename and Delete.
  const entries = layout.list.flatMap((entry): MenuChoice[] =>
    entry.action === "shuffle"
      ? [{ action: "shuffle", label: PLAY_ACTION_LABELS.shuffle, onPress: () => play(true) }]
      : [entry, ...(entry.action === "addToPlaylist" ? downloads : [])],
  );

  return (
    <MenuCard
      heading={targetHeading(target, sectionSongs)}
      // A Library entry's heading counts the songs it acts on, which its row doesn't show.
      alwaysHeading={target.kind === "section"}
      cards={cards}
      entries={[...entries, ...extraEntries]}
    />
  );
}

/**
 * What a menu card draws: its heading (unless the row it was opened from is
 * highlighted), then its play cards and entries.
 */
function MenuCard({
  heading: head,
  alwaysHeading = false,
  cards,
  entries,
}: {
  heading: Heading | undefined;
  /** Shows the heading even under a highlight (`CardHeading`'s `always`). */
  alwaysHeading?: boolean;
  cards: readonly PlayCardChoice[];
  entries: readonly MenuChoice[];
}) {
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
      <MenuChoices cards={cards} entries={entries} />
    </>
  );
}
