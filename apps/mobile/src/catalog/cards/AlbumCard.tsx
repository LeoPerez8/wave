import { View } from "react-native";

import { Artwork } from "../Artwork";
import { TileCheck } from "../CheckCell";
import { CELL } from "../grid";
import { useLocalisation } from "@/localisation/localisation";

import { CAPTION_TOP, CardDetail, CardRow, CardTile, CardTitle } from "./CardParts";

/** The album's cover in a row: 40dp, 4dp corners. */
const THUMB = CELL * 5;

type Props = {
  title: string;
  /** The album's artist, the line under the title. */
  artist: string;
  /** What takes the artist's place while the album downloads: "Downloading · N of M". */
  line?: string | null | undefined;
  /** File URI of the cached artwork; absent when there is none. */
  artworkUri?: string | undefined;
  tint?: string | undefined;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  /** In selection mode, whether it is checked: a check on the cover (tile), a leading check cell (row). */
  checked?: boolean | undefined;
};

/** An album on a shelf or in a grid: a square cover at [size], 6dp corners, the title and artist under it. */
export function AlbumCard({
  title,
  artist,
  line,
  artworkUri,
  tint,
  size,
  onPress,
  onLongPress,
  checked,
}: Props & { size: number }) {
  const { strings } = useLocalisation();
  return (
    <CardTile
      width={size}
      label={[strings.library.albumLabel(title, artist), line].filter(Boolean).join(", ")}
      onPress={onPress}
      onLongPress={onLongPress}
      checked={checked}
    >
      <View>
        <Artwork uri={artworkUri} tint={tint} size={size} radius={CELL * 0.75} />
        {checked !== undefined && <TileCheck checked={checked} />}
      </View>
      <View style={{ paddingTop: CAPTION_TOP }}>
        <CardTitle>{title}</CardTitle>
        <CardDetail size="footnote">{line ?? artist}</CardDetail>
      </View>
    </CardTile>
  );
}

/**
 * An album in a list: its cover at 40dp with 4dp corners, then "Album · <artist>",
 * or [line] alone while the album downloads.
 */
export function AlbumCardRow({
  title,
  artist,
  line,
  artworkUri,
  tint,
  onPress,
  onLongPress,
  checked,
}: Props) {
  const { strings } = useLocalisation();
  return (
    <CardRow
      lead={<Artwork uri={artworkUri} tint={tint} size={THUMB} radius={CELL / 2} />}
      title={title}
      detail={line ?? strings.library.albumRow(artist)}
      onPress={onPress}
      onLongPress={onLongPress}
      checked={checked}
    />
  );
}
