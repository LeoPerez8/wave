import type { GeniusLyricsHit } from "@wave/core";
import { joinArtists } from "@wave/core";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { artworkUri } from "@/catalog/artworkUri";
import { CELL, grid } from "@/catalog/grid";
import { useLocalisation } from "@/localisation/localisation";
import { openMixedSongActions } from "@/songs/mixedSongs";
import { useThemeColor } from "@/theme/useThemeColor";

import { openGeniusHitActions } from "./GeniusHitActions";
import type { LocalLyricsHit } from "./lyricsSearch";
import { playSearchSong } from "./playSearchSong";

/** Rows stay in place while song results are selected, as Search's other non-song results do. */
const ignore = (): void => undefined;

/** A lyric result row's height: a song row with its matched line under it. */
export const LYRIC_ROW_HEIGHT = grid.row + CELL * 2;

/** A Library or saved streamed song whose lyrics hold the query, its matched words marked. */
export function LyricResultRow({
  hit,
  selecting,
  onOpen,
}: {
  hit: LocalLyricsHit;
  /** Song results are being selected: this row takes no taps meanwhile. */
  selecting: boolean;
  onOpen: () => void;
}) {
  const song =
    hit.source === "library"
      ? { source: "library" as const, track: hit.song }
      : { source: "stream" as const, song: hit.song };
  const title = hit.song.title;
  const artist = hit.source === "library" ? hit.song.artist : joinArtists(hit.song.artists);
  const artwork =
    hit.source === "library" ? artworkUri(hit.song) : (hit.song.artworkUrl ?? undefined);
  const parts: { text: string; highlighted: boolean }[] = [];
  let cursor = 0;
  for (const range of hit.ranges) {
    if (range.start > cursor)
      parts.push({ text: hit.line.slice(cursor, range.start), highlighted: false });
    parts.push({ text: hit.line.slice(range.start, range.end), highlighted: true });
    cursor = range.end;
  }
  if (cursor < hit.line.length) parts.push({ text: hit.line.slice(cursor), highlighted: false });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${artist}. ${hit.line}`}
      className="flex-row items-center"
      style={{ height: LYRIC_ROW_HEIGHT, gap: CELL * 1.5 }}
      onPress={
        selecting
          ? ignore
          : () => {
              onOpen();
              void playSearchSong(song);
            }
      }
      onLongPress={selecting ? ignore : () => openMixedSongActions(song)}
    >
      <Artwork uri={artwork} size={CELL * 5} />
      <View className="flex-1">
        <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
          {title}
        </Text>
        <Text numberOfLines={1} className="font-sans text-footnote text-secondary">
          {artist}
        </Text>
        <Text numberOfLines={1} className="font-sans text-footnote text-secondary">
          {parts.map((part, index) => (
            <Text key={index} className={part.highlighted ? "text-accent" : undefined}>
              {part.text}
            </Text>
          ))}
        </Text>
      </View>
    </Pressable>
  );
}

/** A song Genius found by its lyrics; a tap plays it, a long press opens its menu. */
export function GeniusLyricResultRow({
  hit,
  selecting,
  pending,
  onOpen,
  onGeniusHit,
}: {
  hit: GeniusLyricsHit;
  /** Song results are being selected: this row takes no taps meanwhile. */
  selecting: boolean;
  /** Its song is being looked up after a tap. */
  pending: boolean;
  onOpen: () => void;
  onGeniusHit: (hit: GeniusLyricsHit) => void;
}) {
  const { strings } = useLocalisation();
  const tertiary = useThemeColor("tertiary");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={strings.playbackText.geniusLyricsResult(hit.title, hit.artist)}
      className="flex-row items-center"
      accessibilityState={{ busy: pending }}
      style={{ height: LYRIC_ROW_HEIGHT, gap: CELL * 1.5 }}
      onPress={
        selecting
          ? ignore
          : () => {
              onOpen();
              onGeniusHit(hit);
            }
      }
      onLongPress={selecting ? ignore : () => openGeniusHitActions(hit)}
    >
      <Artwork uri={hit.artworkUrl ?? undefined} size={CELL * 5} />
      <View className="flex-1">
        <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
          {hit.title}
        </Text>
        <Text numberOfLines={1} className="font-sans text-footnote text-secondary">
          {hit.artist}
        </Text>
      </View>
      {/* Its song is being looked up (the Library, then YT Music) before it plays. */}
      {pending && <ActivityIndicator size="small" color={tertiary} />}
    </Pressable>
  );
}
