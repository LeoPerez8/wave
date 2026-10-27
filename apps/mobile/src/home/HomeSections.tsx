import type { PlayedAlbum, PlayedArtist } from "@/library/db/playedEntities";
import { PlayedAlbumCard, PlayedArtistCard } from "@/stats/PlayedEntityViews";
import { discoverTrackId, type QueueContext } from "@wave/core";
import { useCallback, useMemo } from "react";

import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { runTrackSwipe } from "@/playback/rowSwipe";
import type { SongRow } from "@/library/LibraryStore";
import type { MostPlayedRow } from "@/library/db/playHistory";
import { playPlaylist, playSongs } from "@/playback/actions";
import { openTrackActions } from "@/playback/ActionsMenu";
import { mixedSongEntry, openMixedSongActions, runMixedSongSwipe } from "@/songs/mixedSongs";
import { SongPreview } from "@/songs/SongList";
import { librarySongEntry } from "@/songs/songListSources";

/**
 * A row of album cards that scrolls sideways, edge to edge. `detail` follows
 * an album's artist on its caption (its play count on Most played albums).
 */
export function AlbumShelf<A extends PlayedAlbum>({
  albums,
  detail,
}: {
  albums: readonly A[];
  detail?: (album: A) => string;
}) {
  return (
    <CoverRow>
      {albums.map((album) => (
        <PlayedAlbumCard
          key={album.id}
          album={album}
          detail={detail?.(album)}
          size={COVER_ROW_TILE}
        />
      ))}
    </CoverRow>
  );
}

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
}: {
  songs: readonly A[];
  context: QueueContext;
  /** On a ranking by plays (Most Played), each song's counted plays, shown in place of its length. */
  plays?: (song: A) => number;
}) {
  const places = useMemo(() => new Map(songs.map((song, index) => [song, index])), [songs]);
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
      onMenu={(song) => openTrackActions(song)}
      onSongSwipe={(song, shown) => runTrackSwipe({ kind: "track", items: [{ song }] }, shown)}
    />
  );
}

const mostPlayedEntry = (row: MostPlayedRow) =>
  mixedSongEntry(row, { ...SONG_CARD, countedPlays: row.playCount }, true);

/**
 * Most played as song rows, like `SongRows`, each with its counted plays in
 * place of its length: Library songs and streamed ones (a plain streamed
 * row, dimmed with its tap doing nothing while it can't play). Tapping one
 * plays the list from it.
 */
export function MostPlayedRows({
  rows,
  context,
}: {
  rows: readonly MostPlayedRow[];
  context: QueueContext;
}) {
  const places = useMemo(() => new Map(rows.map((row, index) => [row, index])), [rows]);
  return (
    <SongPreview
      data={rows}
      keyExtractor={discoverTrackId}
      song={mostPlayedEntry}
      context={context}
      onPlay={(row) => void playPlaylist(rows, places.get(row), context)}
      // The menu offers no Select: Home doesn't select.
      onMenu={(row) => openMixedSongActions(row)}
      onSongSwipe={(row, shown) => runMixedSongSwipe(row, shown)}
    />
  );
}

/**
 * A row of artist cards that scrolls sideways, edge to edge, like the album
 * shelves: each artist's circle as wide as an album cover, the name centred
 * under it. Tapping one opens it; long-press opens its menu.
 */
export function ArtistShelf<A extends PlayedArtist>({ artists }: { artists: readonly A[] }) {
  return (
    <CoverRow>
      {artists.map((artist) => (
        <PlayedArtistCard key={artist.id} artist={artist} size={COVER_ROW_TILE} />
      ))}
    </CoverRow>
  );
}
