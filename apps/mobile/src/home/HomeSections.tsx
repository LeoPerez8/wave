import type { QueueContext } from "@wave/core";
import { Text, View } from "react-native";

import { AlbumTile } from "@/catalog/AlbumTile";
import { ArtistImage } from "@/catalog/ArtistImage";
import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { CELL } from "@/catalog/grid";
import { SwipeTrackRow } from "@/library/SwipeTrackRow";
import { toAlbumSummary } from "@/library/AlbumGrid";
import { useFavoriteIds } from "@/library/favorites";
import type { AlbumRow, ArtistRow, SongRow } from "@/library/LibraryStore";
import { openAlbum, openArtist } from "@/library/routes";
import { toTrackSummary } from "@/library/TrackList";
import { playSongs } from "@/playback/actions";
import { useCurrentPlayingIds } from "@/playback/hooks";
import { openAlbumActions, openArtistActions, openTrackActions } from "@/playback/ActionsMenu";
import { Press } from "@/motion/Press";

/**
 * A row of album covers that scrolls sideways, edge to edge. `detail`
 * replaces an album's furniture line (its play count on Most played albums).
 */
export function AlbumShelf<A extends AlbumRow>({
  albums,
  detail,
}: {
  albums: readonly A[];
  detail?: (album: A) => string;
}) {
  return (
    <CoverRow>
      {albums.map((album) => (
        <AlbumTile
          key={album.id}
          album={toAlbumSummary(album)}
          size={COVER_ROW_TILE}
          detail={detail?.(album)}
          onPress={() => openAlbum(album.id, album)}
          onLongPress={() => openAlbumActions(album)}
        />
      ))}
    </CoverRow>
  );
}

/**
 * A short list of songs (Most Played, Favorites). Tapping one plays the list
 * from it; long-press opens the track's menu.
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
          track={toTrackSummary(song)}
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

/** Artist tiles are narrower than covers, so more of the row shows at once. */
const ARTIST_TILE = CELL * 15;

/**
 * A row of artists that scrolls sideways, edge to edge, like the album
 * shelves: each artist's circle, then the name (two lines reserved) over a detail line (its play count
 * on Most played artists). Tapping one opens it; long-press opens its menu.
 */
export function ArtistShelf<A extends ArtistRow>({
  artists,
  detail,
}: {
  artists: readonly A[];
  detail: (artist: A) => string;
}) {
  return (
    <CoverRow>
      {artists.map((artist) => (
        <Press
          key={artist.id}
          accessibilityRole="button"
          accessibilityLabel={`${artist.name}, ${detail(artist)}`}
          onPress={() => openArtist(artist.id, artist)}
          onLongPress={() => openArtistActions(artist)}
          depth={0.02}
          className="gap-0.5"
          style={{ width: ARTIST_TILE }}
        >
          <View style={{ marginBottom: CELL * 1.5 }}>
            <ArtistImage artist={artist} size={ARTIST_TILE} large />
          </View>
          {/* Two lines reserved, so the detail lines align along the row. */}
          <Text
            numberOfLines={2}
            className="font-sans text-body font-medium text-foreground"
            style={{ minHeight: CELL * 5.5 }}
          >
            {artist.name}
          </Text>
          <Text
            numberOfLines={1}
            className="font-sans text-footnote text-secondary"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {detail(artist)}
          </Text>
        </Press>
      ))}
    </CoverRow>
  );
}
