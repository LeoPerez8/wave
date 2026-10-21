import { ytSongArtist } from "@wave/core";
import { Image } from "expo-image";
import type { ReactNode } from "react";
import {
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
} from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import type { NativeYtSong } from "@/native/waveYtMusic";

const COVER = CELL * 5;

/**
 * A row's cover: the song's artwork on the fill colour, or the fill colour alone. Not `Artwork`,
 * whose placeholder is an SVG glyph: drawing an SVG shape in each row of this list makes
 * Reanimated re-apply its whole registry on the main thread per layout event (#446).
 */
function DownloadCover({ uri }: { uri: string | undefined }) {
  return (
    <View className="bg-fill" style={{ width: COVER, height: COVER }}>
      {uri !== undefined && (
        <Image
          source={{ uri }}
          // List rows are recycled; the key stops the previous song's artwork flashing.
          recyclingKey={uri}
          style={{ width: COVER, height: COVER }}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
}

/**
 * A song in Settings › Downloads, queued or failed: its artwork, title and artists, the line
 * that says where it stands, what went wrong when there's [detail], then its buttons
 * ([children], `PlainTextButton`s), over a hairline. Nothing in it draws an SVG or carries an
 * animated style of its own.
 */
export function DownloadSongRow({
  song,
  covers,
  line,
  detail = null,
  accessibilityActions,
  onAccessibilityAction,
  children,
}: {
  song: NativeYtSong;
  /** Whether to show its cover: with YT Music off Wave asks YouTube for nothing. */
  covers: boolean;
  line: string;
  detail?: string | null;
  /** What screen readers can do with the song besides its buttons: Move up / Move down. */
  accessibilityActions?: readonly AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  children?: ReactNode;
}) {
  const artist = ytSongArtist(song);
  return (
    <View>
      <View className="flex-row items-center py-2" style={{ minHeight: grid.row, gap: CELL * 1.5 }}>
        <DownloadCover uri={covers ? (song.artworkUrl ?? undefined) : undefined} />
        <View
          className="flex-1"
          accessible
          accessibilityLabel={[song.title, artist, line, detail].filter(Boolean).join(", ")}
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={onAccessibilityAction}
        >
          <Text className="font-sans text-body font-medium text-foreground">{song.title}</Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {artist}
          </Text>
          <Text className="font-sans text-footnote text-secondary">{line}</Text>
          {detail !== null && (
            <Text numberOfLines={3} className="font-sans text-footnote text-secondary">
              {detail}
            </Text>
          )}
        </View>
        {children}
      </View>
      <Hairline />
    </View>
  );
}
