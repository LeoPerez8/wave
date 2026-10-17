import { ytSongArtist } from "@wave/core";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import type { NativeYtSong } from "@/native/waveYtMusic";

/**
 * A song in Settings › Downloads, queued or failed: its artwork, title and artists, the line
 * that says where it stands, what went wrong when there's [detail], then its buttons
 * ([children]), over a hairline.
 */
export function DownloadSongRow({
  song,
  covers,
  line,
  detail = null,
  children,
}: {
  song: NativeYtSong;
  /** Whether to show its cover: with YT Music off Wave asks YouTube for nothing. */
  covers: boolean;
  line: string;
  detail?: string | null;
  children?: ReactNode;
}) {
  const artist = ytSongArtist(song);
  return (
    <View>
      <View className="flex-row items-center py-2" style={{ minHeight: grid.row, gap: CELL * 1.5 }}>
        <Artwork uri={covers ? (song.artworkUrl ?? undefined) : undefined} size={CELL * 5} />
        <View
          className="flex-1"
          accessible
          accessibilityLabel={[song.title, artist, line, detail].filter(Boolean).join(", ")}
        >
          <Text className="font-sans text-body font-medium text-foreground">{song.title}</Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {artist}
          </Text>
          <Text className="font-sans text-footnote text-secondary">{line}</Text>
          {detail !== null && (
            <Text numberOfLines={3} className="font-sans text-footnote text-tertiary">
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
