import {
  LISTENING_WAVE,
  RECOGNIZE_CARD_ACTION_LABELS,
  recognizeCardView,
  recognizePlaylistSong,
  type RecognizeCard as RecognizeCardState,
  type RecognizeCardAction,
  type RecognizeSource,
} from "@wave/core";
import { useEffect, useRef, useState } from "react";
import { AppState, Linking, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { Artwork } from "@/catalog/Artwork";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { NativeWaveUnderline } from "@/glass/waveGlass";
import { libraryListQueries } from "@/library/hooks";
import type { SongRow } from "@/library/LibraryStore";
import { openAddToPlaylist } from "@/library/PlaylistSheets";
import { openAlbum } from "@/library/routes";
import { appRuntime } from "@/library/runtime";
import { appLog } from "@/log/appLog";
import { online } from "@/native/waveNative";
import { recognizeNative } from "@/native/waveRecognize";
import { showError } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { MenuRow } from "@/overlay/MenuRow";
import { playSongs, playYtSongs, playNext, playYtNext } from "@/playback/actions";
import { useYtMusicEnabled, ytMusicEnabled } from "@/settings/ytMusic";
import { currentLibraryFinder, useLoadedInLibrary } from "@/ytmusic/libraryFinder";
import { searchSongsInTurn } from "@/ytmusic/askYtMusic";
import { cancelYtDownload, downloadYtSong, useYtDownloadStatus } from "@/ytmusic/YtDownloads";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { openOverlay } from "@/overlay/overlay";
import { holdPlayback } from "@/playback/holdPlayback";
import { useTapAnimationMs } from "@/settings/tapAnimation";
import { useThemeColor } from "@/theme/useThemeColor";

import { resolveRecognition } from "./resolveRecognition";
import { hasMicrophone, microphonePermission } from "./microphone";
import {
  startRecognizeSession,
  type RecognizeDeps,
  type RecognizeNative,
  type RecognizeRun,
} from "./recognizeSession";

const COVER = CELL * 9;
const WAVE_HEIGHT = LISTENING_WAVE.amplitude * 2 + LISTENING_WAVE.stroke;

/** Whether this build can recognize (its APK has the native half). */
export const recognizeAvailable = recognizeNative !== null;

const depsFor = (native: RecognizeNative): RecognizeDeps<SongRow, NativeYtSong> => ({
  online,
  microphone: microphonePermission,
  holdPlayback,
  native,
  resolve: (song, signal) =>
    resolveRecognition(
      {
        library: () => appRuntime.runPromise(libraryListQueries.songs.read),
        ytMusic: ytMusicEnabled,
        search: searchSongsInTurn,
      },
      song,
      signal,
    ),
  log: (level, line) => appLog(level, "WaveRecognize", line),
});

/**
 * Opens the Recognize card, already listening (docs/spec.md, "Recognize"). The
 * Search field's Recognize Song button opens it; so can anything else that should
 * start listening at once (the tile and the app shortcut, #772). Closing the card,
 * by Cancel, Back or a tap outside, ends the session.
 */
export const openRecognize = (source: RecognizeSource = "microphone"): void => {
  const native = recognizeNative;
  if (native === null) return;
  openOverlay({
    label: "Recognize Song",
    render: (close) => <RecognizeCard native={native} source={source} close={close} />,
  });
};

/**
 * The glass card: "Listening…" over the moving wave with Cancel, then the song
 * (cover, title, artist, album) or why there's none, with what can be done about it.
 * Each attempt (Try Again, or coming back from Android's settings with the
 * microphone allowed) runs a new session; leaving the card cancels the one running.
 */
function RecognizeCard({
  native,
  source,
  close,
}: {
  native: RecognizeNative;
  source: RecognizeSource;
  close: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  // The card for this attempt; an earlier attempt's end never shows over a new one.
  const [shown, setShown] = useState<{
    attempt: number;
    card: RecognizeCardState<SongRow, NativeYtSong>;
  }>({
    attempt: 0,
    card: { kind: "listening" },
  });
  const run = useRef<RecognizeRun | null>(null);

  useEffect(() => {
    const session = startRecognizeSession(depsFor(native), source, (card) =>
      setShown({ attempt, card }),
    );
    run.current = session;
    return () => session.cancel();
  }, [native, source, attempt]);

  const card: RecognizeCardState<SongRow, NativeYtSong> =
    shown.attempt === attempt ? shown.card : { kind: "listening" };

  // Back from Android's settings with the microphone allowed: listen at once.
  const denied = card.kind === "denied";
  useEffect(() => {
    if (!denied) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void hasMicrophone().then((granted) => {
        if (granted) setAttempt((n) => n + 1);
      });
    });
    return () => subscription.remove();
  }, [denied]);

  const ytMusic = useYtMusicEnabled();
  const result = card.kind === "resolved" ? card.result : null;
  const status = useYtDownloadStatus(result?.kind === "stream" ? result.song.videoId : "");
  const inLibrary = useLoadedInLibrary(result?.kind === "stream");
  const view = recognizeCardView(card, {
    ytMusic,
    status,
    inLibrary: result?.kind === "stream" && inLibrary(result.song),
  });

  const press = (action: RecognizeCardAction): void => {
    switch (action) {
      case "cancel":
        run.current?.cancel();
        close();
        return;
      case "done":
      case "close":
        close();
        return;
      case "listenAgain":
      case "tryAgain":
        setAttempt((n) => n + 1);
        return;
      case "openSettings":
        void Linking.openSettings().catch(() => undefined);
        return;
      default:
        if (result === null || !view.actions.includes(action)) return;
        switch (action) {
          case "addToPlaylist":
            openAddToPlaylist({
              title: result.song.title,
              songs: async () => {
                // A download may have joined the Library while this card stayed open.
                const track =
                  result.kind === "stream" ? (await currentLibraryFinder())(result.song) : null;
                return [
                  track === null
                    ? recognizePlaylistSong(result)
                    : { source: "library", trackId: track.id },
                ];
              },
            });
            return;
          case "play":
            if (result.kind === "library") {
              close();
              void playSongs([result.track], 0, { kind: "search", id: null }).catch(
                (error: unknown) => showError("Couldn't play the song", error),
              );
            } else if (result.kind === "stream") {
              close();
              void playYtSongs([result.song], 0, { kind: "search", id: null }).catch(
                (error: unknown) => showError("Couldn't play the song", error),
              );
            }
            return;
          case "playNext":
            if (result.kind === "library")
              void playNext([result.track]).catch((error: unknown) =>
                showError("Couldn't queue the song", error),
              );
            else if (result.kind === "stream")
              void playYtNext([result.song]).catch((error: unknown) =>
                showError("Couldn't queue the song", error),
              );
            return;
          case "goToAlbum":
            if (result.kind === "library") {
              close();
              openAlbum(result.track.albumId);
            }
            return;
          case "download":
          case "retryDownload":
            if (result.kind === "stream") downloadYtSong(result.song);
            return;
          case "cancelDownload":
            if (result.kind === "stream") cancelYtDownload(result.song.videoId);
            return;
        }
    }
  };
  return (
    <>
      <View style={{ paddingTop: CELL, paddingBottom: CELL * 2, gap: CELL * 1.5 }}>
        <CatalogLine>Recognize Song</CatalogLine>
        <View className="flex-row items-center" style={{ gap: CELL * 1.5 }}>
          {view.cover && (
            <Artwork uri={view.coverUrl ?? undefined} size={COVER} radius={CELL / 2} />
          )}
          <View className="flex-1" style={{ gap: CELL / 2 }}>
            <Text
              accessibilityLiveRegion="polite"
              numberOfLines={2}
              className="font-sans text-title3 font-normal text-foreground"
            >
              {view.title}
            </Text>
            {view.lines.map((line) => (
              <Text
                key={line}
                numberOfLines={view.cover ? 1 : undefined}
                className="font-sans text-subheadline text-secondary"
              >
                {line}
              </Text>
            ))}
          </View>
        </View>
        {view.listening && <ListeningWave />}
      </View>
      {card.kind === "resolved" ? (
        <>
          <CardEntries>
            {view.actions.map((action) => {
              switch (action) {
                case "play":
                case "playNext":
                case "addToPlaylist":
                case "goToAlbum":
                case "download":
                case "retryDownload":
                case "cancelDownload":
                  return (
                    <MenuRow
                      key={action}
                      action={action}
                      label={RECOGNIZE_CARD_ACTION_LABELS[action]}
                      onPress={() => press(action)}
                    />
                  );
                default:
                  return null;
              }
            })}
          </CardEntries>
          <TextButton
            label={RECOGNIZE_CARD_ACTION_LABELS.listenAgain}
            onPress={() => press("listenAgain")}
            style={{ alignSelf: "flex-end" }}
          />
        </>
      ) : (
        <View className="flex-row items-center justify-end" style={{ gap: CELL * 3 }}>
          {view.actions.map((action) => (
            <TextButton
              key={action}
              label={RECOGNIZE_CARD_ACTION_LABELS[action]}
              onPress={() => press(action)}
            />
          ))}
        </View>
      )}
    </>
  );
}

/**
 * The moving wave, in the accent colour. It ripples on the RenderThread (a native
 * AnimatedVectorDrawable, as the playing song's underline does), so it never makes
 * the card's glass re-blur (issue #93); it lies still under reduce motion or with the
 * tap animation at 0 ms.
 */
function ListeningWave() {
  const accent = useThemeColor("accent");
  const reduceMotion = useReducedMotion();
  const tapAnimationMs = useTapAnimationMs();
  return (
    <NativeWaveUnderline
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      shape="listening"
      color={accent}
      animating={!reduceMotion && tapAnimationMs > 0}
      style={{ alignSelf: "stretch", height: WAVE_HEIGHT }}
    />
  );
}
