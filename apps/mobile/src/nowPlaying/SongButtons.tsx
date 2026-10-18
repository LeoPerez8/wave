import {
  IconCircleDashed,
  IconDownload,
  IconPlaylistAdd,
  IconRefreshAlert,
} from "@tabler/icons-react-native";
import { nowPlayingDownload, parseTrackId, type PlaylistSong } from "@wave/core";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { CELL } from "@/catalog/grid";
import { openAddToPlaylist } from "@/library/PlaylistSheets";
import { songHasFile } from "@/library/LibraryStore";
import { Press } from "@/motion/Press";
import { showToast } from "@/overlay/toast";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { useThemeColor } from "@/theme/useThemeColor";
import { currentLibraryFinder, useLoadedLibraryFinder } from "@/ytmusic/libraryFinder";
import {
  downloadMissingSongs,
  downloadYtSong,
  useMissingSongDownloadStatus,
  useYtDownloadStatus,
} from "@/ytmusic/YtDownloads";

import { useNowPlayingShown } from "./sheet";

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
  const secondary = useThemeColor("secondary");
  const ref = trackId === null ? null : parseTrackId(trackId);
  const songs = (): Promise<readonly PlaylistSong[]> => {
    if (ref?.kind === "library") return Promise.resolve([{ source: "library", trackId: ref.id }]);
    if (ytSong === null) return Promise.resolve([]);
    return currentLibraryFinder().then((find) => {
      const track = find(ytSong);
      return [
        track === null
          ? { source: "stream", song: ytSong }
          : { source: "library", trackId: track.id },
      ];
    });
  };
  const disabled = ref?.kind !== "library" && ytSong === null;
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel="Add to Playlist"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => openAddToPlaylist({ title, songs })}
      opensMenu
      haptic="selection"
      depth={0.1}
      className="items-center justify-center"
      style={BOX}
    >
      <IconPlaylistAdd size={ICON} color={secondary} strokeWidth={1.5} />
    </Press>
  );
}

/** How far a download has come, as a ring filling clockwise from the top. */
function ProgressRing({ fraction }: { fraction: number }) {
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
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
  const accent = useThemeColor("accent");
  const shown = useNowPlayingShown();
  // Null until the Library is first read: no button that would only change.
  const find = useLoadedLibraryFinder(shown);
  // A Library song in the queue plays its file.
  const librarySong = trackId !== null && parseTrackId(trackId)?.kind === "library";
  const track = ytSong === null || find === null ? null : find(ytSong);
  const missingId = track !== null && !songHasFile(track) ? track.id : null;
  const ytStatus = useYtDownloadStatus(ytSong?.videoId ?? "");
  const missingStatus = useMissingSongDownloadStatus(missingId);
  const hasFile = librarySong || (track !== null && missingId === null);
  const state = nowPlayingDownload(missingId === null ? ytStatus : missingStatus, { hasFile });
  if (!librarySong && (ytSong === null || find === null)) return null;
  if (state.kind === "downloaded") return <DownloadedButton color={accent} />;
  if (ytSong === null) return null;

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

  const download = (): void => {
    if (missingId === null) downloadYtSong(ytSong);
    else downloadMissingSongs([missingId]);
  };
  const failed = state.kind === "failed";
  const Icon = failed ? IconRefreshAlert : IconDownload;
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={failed ? "Download failed" : "Download"}
      accessibilityHint={failed ? "Tries the download again" : undefined}
      onPress={download}
      haptic="selection"
      depth={0.1}
      className="items-center justify-center"
      style={BOX}
    >
      <Icon size={ICON} color={secondary} strokeWidth={1.5} />
    </Press>
  );
}

/** Download, tinted, for a song this phone has the file of: a tap only says so. */
function DownloadedButton({ color }: { color: string }) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel="Downloaded"
      onPress={() => void showToast("Downloaded")}
      haptic="selection"
      depth={0.1}
      className="items-center justify-center"
      style={BOX}
    >
      <IconDownload size={ICON} color={color} strokeWidth={1.5} />
    </Press>
  );
}
