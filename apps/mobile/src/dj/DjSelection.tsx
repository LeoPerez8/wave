import type { DjTile, DjTileKey } from "@wave/core";
import { IconCircleCheckFilled, IconX } from "@tabler/icons-react-native";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";

import { ArtistImage } from "@/catalog/ArtistImage";
import { Artwork } from "@/catalog/Artwork";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { useLocalisation } from "@/localisation/localisation";
import { Press } from "@/motion/Press";
import { usePlayedArtist } from "@/stats/PlayedEntityViews";
import { useThemeColor } from "@/theme/useThemeColor";
import type { ArtistRow } from "@wave/client";

/** The corners of DJ's square tiles (albums, genres), in the grid and in the selection row. */
export const DJ_TILE_RADIUS = CELL * 0.75;

/** A selected tile's ring, in the primary colour around its picture. */
const RING = 2.5;

/** How far a selected tile's picture sits inside its ring, the ring included. */
const RING_INSET = CELL * 0.75;

/** The filled check's size, and its disc of the screen's ground that sets it off the picture. */
const CHECK = 24;
const CHECK_DISC = CHECK + 4;

/** A mark of the selection row. */
const MARK = 52;

/** A mark's remove badge, overlapping the mark's top-right corner by [BADGE_OVERLAP]. */
const BADGE = 20;
const BADGE_OVERLAP = CELL / 2;

/**
 * A grid tile's picture, [size] square: as it is, or once selected inside a
 * ring in the primary colour, a little smaller, with a filled check in the
 * primary colour at its bottom-right corner. [round] is an artist's circle;
 * otherwise the square of an album or genre tile. [picture] draws the
 * picture at the size it's given.
 */
export function DjTilePicture({
  size,
  round,
  selected,
  picture,
}: {
  size: number;
  round: boolean;
  selected: boolean;
  picture: (size: number) => ReactNode;
}) {
  const accent = useThemeColor("accent");
  const inner = selected ? size - RING_INSET * 2 : size;
  return (
    <View style={{ width: size, height: size }}>
      {selected && (
        <View
          pointerEvents="none"
          className="absolute border-accent"
          style={{
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            borderWidth: RING,
            borderRadius: round ? size / 2 : DJ_TILE_RADIUS + RING_INSET,
          }}
        />
      )}
      <View style={{ position: "absolute", top: (size - inner) / 2, left: (size - inner) / 2 }}>
        {picture(inner)}
      </View>
      {selected && (
        <View
          pointerEvents="none"
          className="absolute items-center justify-center rounded-full bg-background"
          style={{
            right: round ? 0 : -CELL / 2,
            bottom: round ? 0 : -CELL / 2,
            width: CHECK_DISC,
            height: CHECK_DISC,
          }}
        >
          <IconCircleCheckFilled size={CHECK} color={accent} />
        </View>
      )}
    </View>
  );
}

/** An artist's mark: their image in a circle, the Library's one when it has them. */
function ArtistMark({ tile, artist }: { tile: DjTile; artist: ArtistRow | undefined }) {
  const { image } = usePlayedArtist(
    artist ?? { id: tile.key, online: true, name: tile.name, thumbPath: null, artworkPath: null },
  );
  return <ArtistImage artist={image} size={MARK} />;
}

/** One tile's mark in the selection row: the tile's picture at 52dp, with its remove badge. */
function SelectionMark({
  tile,
  artist,
  disabled,
  onPress,
}: {
  tile: DjTile;
  artist: ArtistRow | undefined;
  disabled: boolean;
  onPress: () => void;
}) {
  const { strings } = useLocalisation();
  const foreground = useThemeColor("foreground");
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={strings.dj.removeFromSelection(tile.name)}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ width: MARK, height: MARK }}
    >
      {tile.kind === "artist" ? (
        <ArtistMark tile={tile} artist={artist} />
      ) : tile.kind === "album" ? (
        <Artwork uri={tile.cover ?? undefined} size={MARK} radius={DJ_TILE_RADIUS} />
      ) : (
        <View
          className="bg-fill items-center justify-center"
          style={{ width: MARK, height: MARK, borderRadius: DJ_TILE_RADIUS, padding: CELL / 2 }}
        >
          <Text
            numberOfLines={2}
            className="text-center font-sans text-caption font-medium text-foreground"
          >
            {tile.name}
          </Text>
        </View>
      )}
      <View
        pointerEvents="none"
        className="absolute items-center justify-center rounded-full border-background bg-separator"
        style={{
          top: -BADGE_OVERLAP,
          right: -BADGE_OVERLAP,
          width: BADGE,
          height: BADGE,
          // Ringed in the screen's ground, so it reads apart from the mark.
          borderWidth: 2,
        }}
      >
        <IconX size={CELL * 1.5} color={foreground} strokeWidth={2.5} />
      </View>
    </Press>
  );
}

/**
 * DJ's Your selection row, under its title: a catalog line counting the
 * selected tiles, then their marks in selection order (artists as circles,
 * albums and genres as squares), each with a remove badge; a tap on one
 * unselects it ([onRemove]). A dashed slot ends the row, with "Tap artists
 * to start" beside it while nothing is selected. It scrolls sideways when
 * it's longer than the screen, from edge to edge.
 */
export function DjSelectionRow({
  tiles,
  artists,
  disabled,
  onRemove,
}: {
  tiles: readonly DjTile[];
  artists: ReadonlyMap<number, ArtistRow>;
  disabled: boolean;
  onRemove: (key: DjTileKey) => void;
}) {
  const { strings } = useLocalisation();
  return (
    <View style={{ marginHorizontal: -grid.margin }}>
      <View style={{ paddingHorizontal: grid.margin }}>
        <CatalogLine>{strings.dj.selection(tiles.length)}</CatalogLine>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: grid.margin,
          // Room for the remove badges, which stand out of their marks.
          paddingTop: CELL * 1.5,
          gap: CELL * 2,
          alignItems: "center",
        }}
      >
        {tiles.map((tile) => (
          <SelectionMark
            key={tile.key}
            tile={tile}
            artist={
              tile.kind === "artist" && tile.libraryId !== null
                ? artists.get(tile.libraryId)
                : undefined
            }
            disabled={disabled}
            onPress={() => onRemove(tile.key)}
          />
        ))}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="border-tertiary"
          style={{
            width: MARK,
            height: MARK,
            borderRadius: MARK / 2,
            borderWidth: 1.5,
            borderStyle: "dashed",
          }}
        />
        {tiles.length === 0 && (
          <Text className="font-sans text-footnote text-secondary">
            {strings.dj.selectionEmpty}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
