import { IconCircleArrowDownFilled, IconFileOff, IconStarFilled } from "@tabler/icons-react-native";
import { trackRowTrailing, ytDownloadLine, ytDownloadProgress } from "@wave/core";
import { Text, View, type PressableProps as PressProps } from "react-native";

import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";
import { useMissingSongDownloadStatus } from "@/ytmusic/YtDownloads";

import { Artwork } from "./Artwork";
import { CheckCell } from "./CheckCell";
import { SONG_ROW_COVER, SongCover } from "./cards/SongCard";
import { ExplicitBadge } from "./ExplicitBadge";
import { CELL, grid } from "./grid";
import { RankNumber } from "./RankNumber";
import { SwipeableRow, swipeAccessibility, type RowSwipe } from "./SwipeableRow";
import { WavyUnderline } from "./WavyUnderline";

export type TrackSummary = {
  id: string;
  title: string;
  artist: string;
  /** Null when unknown (a YT Music song that doesn't say); the cell stays reserved. */
  durationMs: number | null;
  trackNumber?: number | undefined;
  artworkUri?: string | undefined;
  tint?: string | undefined;
  /**
   * A missing song's Track: the Wave account has it and this phone has no
   * file for it. The row is dimmed, with the look of a YT Music song not
   * downloaded (no downloaded icon), and a tap downloads it; while it
   * downloads, its line and progress show as a YT Music song's do.
   */
  missingTrackId?: number | undefined;
  /** An explicit song (Core's `showsExplicitBadge`): an E badge follows its title. */
  explicit?: boolean | undefined;
};

/** A row playing now, or one whose file a scan no longer finds ("File not found"). */
export type TrackState = "playing" | "fileNotFound" | undefined;

type Props = {
  track: TrackSummary;
  state?: TrackState;
  favorite?: boolean;
  /** Songs lists show a thumbnail; album track lists show the track number. */
  leading: "artwork" | "number";
  /**
   * With artwork leading: the cover is a song card's, 4dp corners with a play
   * disc on its corner (Search's song results). Undefined or false: the square cover.
   */
  playDisc?: boolean;
  /** Sets the number in ember: the top entry of a ranking, whose number is its rank. */
  topNumber?: boolean;
  /**
   * On a ranking by plays, the song's counted plays: shown in the trailing
   * cell ("12 plays") in place of its length. Undefined shows the length.
   */
  plays?: number | undefined;
  /**
   * In selection mode, whether the row is checked: it shows a leading check
   * cell and reads as a checkbox. Undefined outside selection mode.
   */
  checked?: boolean | undefined;
  /**
   * How much of a download has arrived (0–1): a thin teal rule under the
   * title and second line, filling up. Undefined (or null) shows none.
   */
  progress?: number | null | undefined;
  /**
   * In a list that mixes the Library's songs with YT Music's, marks a Library
   * song: a small downloaded icon leads its second line.
   */
  downloaded?: boolean;
  /**
   * A song that can't play (a playlist's unavailable entry): dimmed as a
   * missing song is, with its menu still open.
   */
  unavailable?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /** Screen-reader actions standing in for gestures (move, remove in a playlist). */
  accessibilityActions?: PressProps["accessibilityActions"];
  onAccessibilityAction?: PressProps["onAccessibilityAction"];
  /**
   * What swiping the row runs (`SwipeableRow`), each direction an entry of
   * its menu, offered to screen readers too. Undefined: the row doesn't swipe.
   * Never while selecting.
   */
  swipe?: RowSwipe | undefined;
};

const THUMB = CELL * 5;

/**
 * A track: leading thumbnail or track number, title over artist, then the
 * favorite cell and the duration (the counted plays on a ranking by plays). The playing track's title is in ember with a
 * wavy underline under its visible text. A file not found shows its icon (in
 * place of the number in numbered lists, trailing in artwork lists). Title and
 * artist share one size; rank is weight and tint. In selection mode a check
 * cell leads the row. An explicit song's E badge follows its title. A missing song (`missingTrackId`) is dimmed (as docs/spec.md,
 * "Missing songs", says), its long press still open, and shows its download as it goes.
 */
export function TrackRow({
  track,
  state,
  favorite = false,
  leading,
  playDisc = false,
  topNumber = false,
  plays,
  checked,
  progress,
  downloaded = false,
  unavailable = false,
  onPress,
  onLongPress,
  accessibilityActions,
  onAccessibilityAction,
  swipe,
}: Props) {
  const highlight = useThemeColor("highlight");
  const accent = useThemeColor("accent");
  const tertiary = useThemeColor("tertiary");
  const fileNotFound = state === "fileNotFound";
  const playing = state === "playing";
  const missingSong = track.missingTrackId !== undefined;
  const download = useMissingSongDownloadStatus(track.missingTrackId ?? null);
  const downloadLine = ytDownloadLine(download);
  const shownProgress = progress ?? ytDownloadProgress(download);
  const selecting = checked !== undefined;
  const fileNotFoundIcon = <IconFileOff size={18} color={tertiary} strokeWidth={1.5} />;
  const trailing = trackRowTrailing({ durationMs: track.durationMs, countedPlays: plays });
  const actions =
    swipe === undefined || selecting
      ? { accessibilityActions, onAccessibilityAction }
      : swipeAccessibility(swipe, accessibilityActions, onAccessibilityAction);

  const row = (
    <Press
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityLabel={[
        track.title,
        track.artist,
        ...(track.explicit === true ? ["explicit"] : []),
        ...(plays === undefined ? [] : [trailing]),
        ...(downloaded && !missingSong ? ["downloaded"] : []),
        ...(missingSong ? [downloadLine ?? "not downloaded"] : []),
        ...(unavailable ? ["unavailable"] : []),
        ...(playing ? ["now playing"] : []),
      ].join(", ")}
      accessibilityState={
        selecting
          ? { disabled: fileNotFound, checked }
          : { disabled: fileNotFound, selected: playing }
      }
      disabled={fileNotFound}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={actions.accessibilityActions}
      onAccessibilityAction={actions.onAccessibilityAction}
      depth={0.015}
    >
      <View
        className={`flex-row items-center ${missingSong || unavailable ? "opacity-45" : ""}`}
        style={{ height: grid.row, gap: CELL * 1.5 }}
      >
        {selecting && <CheckCell checked={checked} />}
        {leading === "artwork" ? (
          playDisc ? (
            <SongCover uri={track.artworkUri} tint={track.tint} size={THUMB} {...SONG_ROW_COVER} />
          ) : (
            <Artwork uri={track.artworkUri} tint={track.tint} size={THUMB} />
          )
        ) : !fileNotFound && track.trackNumber !== undefined ? (
          <RankNumber rank={track.trackNumber} top={topNumber} />
        ) : (
          <View className="items-center" style={{ width: grid.stateCell }}>
            {fileNotFound && fileNotFoundIcon}
          </View>
        )}
        <View className="flex-1">
          <View className="flex-row items-center" style={{ gap: CELL / 2 }}>
            {/* Hugs the title's visible (possibly truncated) text, so the underline spans just that. */}
            <View style={{ flexShrink: 1 }}>
              <Text
                numberOfLines={1}
                className={`font-sans text-body font-medium ${
                  playing ? "text-highlight" : fileNotFound ? "text-secondary" : "text-foreground"
                }`}
              >
                {track.title}
              </Text>
              {playing && <WavyUnderline />}
            </View>
            {track.explicit === true && <ExplicitBadge />}
          </View>
          <View className="flex-row items-center" style={{ gap: CELL / 2 }}>
            {downloaded && !fileNotFound && !missingSong && (
              <IconCircleArrowDownFilled size={14} color={accent} />
            )}
            <Text numberOfLines={1} className="flex-1 font-sans text-body text-secondary">
              {fileNotFound ? "File not found" : (downloadLine ?? track.artist)}
            </Text>
          </View>
          {shownProgress !== undefined && shownProgress !== null && (
            <View className="bg-separator" style={{ height: 2, marginTop: CELL / 2 }}>
              <View
                className="bg-accent"
                style={{ height: 2, width: `${Math.round(shownProgress * 100)}%` }}
              />
            </View>
          )}
        </View>
        {leading === "artwork" && fileNotFound && (
          <View className="items-center" style={{ width: CELL * 3 }}>
            {fileNotFoundIcon}
          </View>
        )}
        <View className="items-center" style={{ width: CELL * 3 }}>
          {favorite && <IconStarFilled size={14} color={highlight} />}
        </View>
        {/* A count is wider than a length, so a ranking by plays gets a wider cell. */}
        <Text
          numberOfLines={1}
          className="font-sans text-footnote text-secondary"
          style={{
            fontVariant: ["tabular-nums"],
            ...(plays === undefined ? { width: CELL * 5 } : { minWidth: CELL * 9 }),
            textAlign: "right",
          }}
        >
          {trailing}
        </Text>
      </View>
    </Press>
  );
  return swipe === undefined ? (
    row
  ) : (
    <SwipeableRow swipe={swipe} enabled={!selecting}>
      {row}
    </SwipeableRow>
  );
}
