import {
  IconCircleDashed,
  IconDownload,
  IconPlaylistAdd,
  IconRefreshAlert,
} from "@tabler/icons-react-native";
import { nowPlayingDownload } from "@wave/core";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { CELL } from "@/catalog/grid";
import { openAddToPlaylist } from "@/library/PlaylistSheets";
import { songHasFile } from "@/library/LibraryStore";
import { IconButton } from "@/components/IconButton";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { useThemeColor } from "@/theme/useThemeColor";
import { useMissingSongDownloadStatus, useYtDownloadStatus } from "@/ytmusic/YtDownloads";

import {
  nowPlayingSongActions,
  songActionFailed,
  usePlayingSongAnswer,
  usePlayingSongTarget,
} from "./playingSong";

const BOX = { width: CELL * 6, height: CELL * 6 } as const;
const ICON = 24;

/**
 * Add to Playlist: the playlist picker for the song playing. A streamed song
 * goes in as the Library's song when the Library has it, else as a YT Music
 * entry, as its menu adds it.
 */
export function AddToPlaylistButton({
  trackId,
  ytSong,
  title,
}: {
  trackId: string | null;
  ytSong: NativeYtSong | null;
  title: string;
}) {
  const target = usePlayingSongTarget(trackId, ytSong);
  const disabled = target === null;
  const songs = () =>
    target === null ? Promise.resolve([]) : nowPlayingSongActions.playlist(target);
  return (
    <IconButton
      icon={IconPlaylistAdd}
      label="Add to Playlist"
      tone="secondary"
      disabledTone="secondary"
      disabled={disabled}
      onPress={() => openAddToPlaylist({ title, songs })}
      opensMenu
    />
  );
}

/** How far a download has come, as a ring filling clockwise from the top. */
function ProgressRing({ fraction }: { fraction: number }) {
  const [accent, secondary] = useThemeColor(["accent", "secondary"]);
  const size = ICON - 2;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={secondary}
        strokeOpacity={0.3}
        strokeWidth={stroke}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={accent}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${length} ${length}`}
        strokeDashoffset={length * (1 - fraction)}
        fill="none"
      />
    </Svg>
  );
}

/**
 * Download, for a song this phone has no file for: it starts the song's
 * download as its menu's Download does (into its Library entry when the
 * Library lists it as missing), then shows it waiting and a progress ring
 * while it downloads. A failed one shows so, and a tap retries. Once the song
 * is in the Library (and for a Library song playing) it stays, tinted with
 * the primary colour, and a tap only says "Downloaded" (Core's
 * `nowPlayingDownload`).
 */
export function DownloadButton({
  trackId,
  ytSong,
}: {
  trackId: string | null;
  ytSong: NativeYtSong | null;
}) {
  const secondary = useThemeColor("secondary");
  const target = usePlayingSongTarget(trackId, ytSong);
  const answer = usePlayingSongAnswer(target);
  const track = answer?.track ?? null;
  const missingId = track !== null && !songHasFile(track) ? track.id : null;
  const ytStatus = useYtDownloadStatus(ytSong?.videoId ?? "");
  const missingStatus = useMissingSongDownloadStatus(missingId);
  const state = nowPlayingDownload(missingId === null ? ytStatus : missingStatus, {
    hasFile: track !== null && missingId === null,
  });
  if (target === null) return null;
  const download = (): void => {
    void nowPlayingSongActions.download(target).catch(songActionFailed);
  };
  if (state.kind === "downloaded")
    return <IconButton icon={IconDownload} label="Downloaded" onPress={download} />;

  if (state.kind === "waiting" || state.kind === "progress") {
    const percent = state.kind === "progress" ? Math.round(state.fraction * 100) : null;
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={percent === null ? "Waiting to download" : "Downloading"}
        accessibilityValue={percent === null ? undefined : { min: 0, max: 100, now: percent }}
        className="items-center justify-center"
        style={BOX}
      >
        {state.kind === "progress" ? (
          <ProgressRing fraction={state.fraction} />
        ) : (
          <IconCircleDashed size={ICON} color={secondary} strokeWidth={1.5} />
        )}
      </View>
    );
  }

  const failed = state.kind === "failed";
  const Icon = failed ? IconRefreshAlert : IconDownload;
  return (
    <IconButton
      icon={Icon}
      label={failed ? "Download failed" : "Download"}
      accessibilityHint={failed ? "Tries the download again" : undefined}
      tone="secondary"
      onPress={download}
    />
  );
}
