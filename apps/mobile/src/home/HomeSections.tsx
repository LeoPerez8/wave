import { usePositions } from "@/lib/usePositions";
import { useLocalisation } from "@/localisation/localisation";
import type { PlayedAlbum, PlayedArtist } from "@wave/client/db/playedEntities";
import { PlayedAlbumCard, PlayedArtistCard } from "@/stats/PlayedEntityViews";
import { discoverTrackId, type QueueContext } from "@wave/core";
import { useCallback } from "react";

import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { runTrackSwipe } from "@/playback/rowSwipe";
import type { SongRow } from "@wave/client";
import type { MostPlayedRow } from "@wave/client/db/playHistory";
import { playPlaylist, playSongs } from "@/playback/actions";
import { openAlbumActions, openTrackActions } from "@/playback/ActionsMenu";
import {
  mixedSongEntry,
  openMixedSongActions,
  runMixedSongSwipe,
  songSelection,
} from "@/songs/mixedSongs";
import { SongPreview } from "@/songs/SongList";
import { librarySongEntry } from "@/songs/songListSources";
import {
  albumItem,
  onlineAlbumItem,
  trackItem,
  ytTrackItem,
  type MixedItem,
} from "@/playback/mixedItems";
import { type HomeSelection, useHomeTiles } from "@/selection/useHomeSelection";
import { MenuChoices } from "@/overlay/MenuChoices";
import { openOverlay } from "@/overlay/overlay";

/**
 * A row of album cards that scrolls sideways, edge to edge. `detail` follows
 * an album's artist on its caption (its play count on Most played albums).
 */
export function AlbumShelf<A extends PlayedAlbum>({
  albums,
  detail,
  selection,
}: {
  albums: readonly A[];
  detail?: (album: A) => string;
  selection?: HomeSelection;
}) {
  const { strings } = useLocalisation();
  const activeSelection = selection?.enabled ? selection : undefined;
  const items = albums.map((album) =>
    "online" in album ? onlineAlbumItem(album) : albumItem(album),
  );
  useHomeTiles(activeSelection, items);
  return (
    <CoverRow staged>
      {albums.map((album, place) => (
        <PlayedAlbumCard
          key={album.id}
          album={album}
          detail={detail?.(album)}
          size={COVER_ROW_TILE}
          selecting={activeSelection?.selecting ?? false}
          checked={
            activeSelection?.selecting ? activeSelection.isChecked(items[place]!) : undefined
          }
          onPress={
            activeSelection === undefined || !activeSelection.selecting
              ? undefined
              : () => activeSelection.toggle(items[place]!)
          }
          onLongPress={
            activeSelection === undefined || activeSelection.selecting
              ? undefined
              : () => {
                  const item = items[place]!;
                  if ("online" in album)
                    openSelectOnlyMenu(album.title, strings.itemActions.labels.select, () =>
                      activeSelection.start(item),
                    );
                  else openAlbumActions(album, { onSelect: () => activeSelection.start(item) });
                }
          }
        />
      ))}
    </CoverRow>
  );
}

const openSelectOnlyMenu = (title: string, label: string, onSelect: () => void): void => {
  openOverlay({
    label: title,
    render: (close) => (
      <MenuChoices
        cards={[]}
        entries={[
          {
            action: "select",
            label,
            onPress: () => {
              close();
              onSelect();
            },
          },
        ]}
      />
    ),
  });
};

/** A Home song row: a song card's row, "Song · <artist>" under its title, the cover with its play disc. */
const SONG_CARD = { leading: { kind: "playDisc" }, kindLine: true } as const;

const songKey = (song: SongRow): string => String(song.id);

/**
 * A short list of songs (Most Played, Favorites) as song rows: each a song
 * card's row, "Song · <artist>" under its title, the cover with its play disc.
 * Tapping one plays the list from it; long-press opens the track's menu.
 */
export function SongRows<A extends SongRow>({
  songs,
  context,
  plays,
  selection,
}: {
  songs: readonly A[];
  context: QueueContext;
  /** On a ranking by plays (Most Played), each song's counted plays, shown in place of its length. */
  plays?: (song: A) => number;
  selection?: HomeSelection;
}) {
  const places = usePositions(songs);
  useHomeTiles(
    selection?.enabled ? selection : undefined,
    songs.map((song) => trackItem(song)),
  );
  const source = useCallback(
    (song: A) => librarySongEntry(song, { ...SONG_CARD, countedPlays: plays?.(song) }),
    [plays],
  );
  return (
    <SongPreview
      data={songs}
      keyExtractor={songKey}
      song={source}
      context={context}
      onPlay={(song) => playSongs(songs, places.get(song), context)}
      onMenu={(song, options) => openTrackActions(song, options)}
      onSongSwipe={(song, shown) => runTrackSwipe({ kind: "track", items: [{ song }] }, shown)}
      selection={
        selection === undefined || !selection.enabled
          ? undefined
          : songSelection<A, MixedItem>(selection, (song) => trackItem(song))
      }
    />
  );
}

const mostPlayedItem = (row: MostPlayedRow): MixedItem =>
  row.source === "library" ? trackItem(row.track) : ytTrackItem(row.song);

/**
 * Most played as song rows, like `SongRows`, each with its counted plays in
 * place of its length: Library songs and streamed ones (a plain streamed
 * row, dimmed with its tap doing nothing while it can't play). Tapping one
 * plays the list from it.
 */
export function MostPlayedRows({
  rows,
  context,
  selection,
}: {
  rows: readonly MostPlayedRow[];
  context: QueueContext;
  selection?: HomeSelection;
}) {
  const { strings } = useLocalisation();
  const places = usePositions(rows);
  useHomeTiles(selection?.enabled ? selection : undefined, rows.map(mostPlayedItem));
  const entry = useCallback(
    (row: MostPlayedRow) =>
      mixedSongEntry(
        row,
        { ...SONG_CARD, trailingLabel: strings.stats.plays(row.playCount) },
        true,
      ),
    [strings],
  );
  return (
    <SongPreview
      data={rows}
      keyExtractor={discoverTrackId}
      song={entry}
      context={context}
      onPlay={(row) => void playPlaylist(rows, places.get(row), context)}
      // The shared Home selection passes Select through this menu too.
      onMenu={(row, options) => openMixedSongActions(row, options)}
      onSongSwipe={(row, shown) => runMixedSongSwipe(row, shown)}
      selection={
        selection === undefined || !selection.enabled
          ? undefined
          : songSelection<MostPlayedRow, MixedItem>(selection, mostPlayedItem)
      }
    />
  );
}

/**
 * A row of artist cards that scrolls sideways, edge to edge, like the album
 * shelves: each artist's circle as wide as an album cover, the name centred
 * under it. Tapping one opens it; long-press opens its menu.
 */
export function ArtistShelf<A extends PlayedArtist>({
  artists,
  selecting = false,
}: {
  artists: readonly A[];
  selecting?: boolean;
}) {
  return (
    <CoverRow staged>
      {artists.map((artist) => (
        <PlayedArtistCard
          key={artist.id}
          artist={artist}
          size={COVER_ROW_TILE}
          selecting={selecting}
        />
      ))}
    </CoverRow>
  );
}
