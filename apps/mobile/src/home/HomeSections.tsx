import type { PlayedAlbum, PlayedArtist } from "@/library/db/playedEntities";
import { PlayedAlbumCard, PlayedArtistCard } from "@/stats/PlayedEntityViews";
import { discoverTrackId, type QueueContext } from "@wave/core";
import { View } from "react-native";

import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { SwipeTrackRow } from "@/library/SwipeTrackRow";
import { useFavoriteIds } from "@/library/favorites";
import type { SongRow } from "@/library/LibraryStore";
import { toTrackSummary } from "@/library/TrackList";
import type { MostPlayedRow } from "@/library/db/playHistory";
import { playRankedSongs, playSongs } from "@/playback/actions";
import { useCurrentPlayingIds } from "@/playback/hooks";
import { openTrackActions } from "@/playback/ActionsMenu";
import { RankedYtSongRow } from "@/ytmusic/YtSongRow";

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
  const currentIds = useCurrentPlayingIds();
  const favorites = useFavoriteIds();
  return (
    <View>
      {songs.map((song, index) => (
        <SwipeTrackRow
          song={song}
          key={song.id}
          track={{ ...toTrackSummary(song), artist: `Song · ${song.artist}` }}
          playDisc
          plays={plays?.(song)}
          state={currentIds.has(String(song.id)) ? "playing" : undefined}
          favorite={favorites.has(song.id)}
          leading="artwork"
          onPress={() => playSongs(songs, index, context)}
          onLongPress={() => openTrackActions(song)}
        />
      ))}
    </View>
  );
}

/**
 * Most played as song rows, like `SongRows`, each with its counted plays in
 * place of its length: Library songs and streamed ones (a plain streamed
 * row, dimmed while it can't play). Tapping one plays the list from it.
 */
export function MostPlayedRows({
  rows,
  context,
}: {
  rows: readonly MostPlayedRow[];
  context: QueueContext;
}) {
  const currentIds = useCurrentPlayingIds();
  const favorites = useFavoriteIds();
  return (
    <View>
      {rows.map((row, index) => {
        const key = discoverTrackId(row);
        const onPress = () => void playRankedSongs(rows, index, context);
        if (row.source === "stream")
          return (
            <RankedYtSongRow
              key={key}
              song={row.song}
              kind="Song · "
              playDisc
              plays={row.playCount}
              playing={currentIds.has(key)}
              onPress={onPress}
            />
          );
        const song = row.track;
        return (
          <SwipeTrackRow
            song={song}
            key={key}
            track={{ ...toTrackSummary(song), artist: `Song · ${song.artist}` }}
            playDisc
            plays={row.playCount}
            state={currentIds.has(key) ? "playing" : undefined}
            favorite={favorites.has(song.id)}
            leading="artwork"
            onPress={onPress}
            onLongPress={() => openTrackActions(song)}
          />
        );
      })}
    </View>
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
