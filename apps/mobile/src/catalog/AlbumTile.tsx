import { CoverTile } from "./CoverTile";

export type AlbumSummary = {
  id: string;
  title: string;
  albumArtist: string;
  year?: number | undefined;
  trackCount: number;
  durationMs: number;
  artworkUri?: string | undefined;
  tint?: string | undefined;
};

const minutes = (album: AlbumSummary): number => Math.max(1, Math.round(album.durationMs / 60_000));

/**
 * "1975 · 9 · 41 min": the same furniture line on every album, in the same
 * place, short enough to never truncate in a two-column grid.
 */
export const furnitureLine = (album: AlbumSummary): string =>
  [album.year, album.trackCount, `${minutes(album)} min`]
    .filter((part) => part !== undefined)
    .join(" · ");

const furnitureLabel = (album: AlbumSummary): string =>
  [
    album.year,
    `${album.trackCount} ${album.trackCount === 1 ? "track" : "tracks"}`,
    `${minutes(album)} minutes`,
  ]
    .filter((part) => part !== undefined)
    .join(", ");

type Props = {
  album: AlbumSummary;
  size: number;
  onPress: () => void;
  onLongPress?: () => void;
  /** Replaces the furniture line (e.g. "12 plays" on a Most played shelf), read out after the title. */
  detail?: string | undefined;
  /**
   * In selection mode, whether the tile is checked: its artwork shows a check
   * in the corner and it reads as a checkbox. Undefined outside selection mode.
   */
  checked?: boolean | undefined;
};

export function AlbumTile({ album, size, onPress, onLongPress, detail, checked }: Props) {
  return (
    <CoverTile
      title={album.title}
      byline={album.albumArtist}
      detail={detail ?? furnitureLine(album)}
      detailLabel={detail ?? furnitureLabel(album)}
      artworkUri={album.artworkUri}
      tint={album.tint}
      size={size}
      onPress={onPress}
      onLongPress={onLongPress}
      checked={checked}
    />
  );
}
