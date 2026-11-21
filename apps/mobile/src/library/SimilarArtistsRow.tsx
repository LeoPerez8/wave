import type { ArtistRow } from "@wave/client";
import type { SimilarArtistLink } from "@wave/core";
import { View } from "react-native";

import { ArtistCard } from "@/catalog/cards/ArtistCard";
import { CAPTION_TOP, titleLineHeight } from "@/catalog/cards/CardParts";
import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { CELL } from "@/catalog/grid";
import { openArtist } from "@/library/routes";
import { openYtArtist } from "@/ytmusic/routes";

/**
 * Height of the Fans might also like row at [fontScale], the gap under it
 * included: an artist's circle, then their name on one line.
 */
export const similarArtistsRowHeight = (fontScale: number): number =>
  COVER_ROW_TILE + CAPTION_TOP + titleLineHeight(fontScale) + CELL * 3;

const ignore = (): void => {};

/**
 * Fans might also like as one row of artists that scrolls sideways, on the
 * Library's artist page and the YT Music artist page alike, laid out as
 * Home's artists are: a similar artist the Library has is its artist and
 * opens the Library's page; the others open their YouTube Music page. While
 * the page selects, they hold still. The tiles have no long-press menu. Only
 * the tiles on screen mount in the row's first frame.
 */
export function SimilarArtistsRow({
  artists,
  height,
  selecting,
}: {
  artists: readonly SimilarArtistLink<ArtistRow>[];
  /** `similarArtistsRowHeight` at the window's font scale. */
  height: number;
  selecting: boolean;
}) {
  return (
    <View style={{ height }}>
      <CoverRow staged>
        {artists.map(({ artist, library }) =>
          library === null ? (
            <ArtistCard
              key={artist.browseId}
              name={artist.name}
              artist={{
                name: artist.name,
                thumbPath: null,
                artworkPath: null,
                imageUrl: artist.artworkUrl,
              }}
              size={COVER_ROW_TILE}
              onPress={
                selecting
                  ? ignore
                  : () => openYtArtist(artist.browseId, artist.name, artist.artworkUrl)
              }
            />
          ) : (
            <ArtistCard
              key={artist.browseId}
              name={library.name}
              artist={library}
              size={COVER_ROW_TILE}
              onPress={selecting ? ignore : () => openArtist(library.id, library)}
            />
          ),
        )}
      </CoverRow>
    </View>
  );
}
