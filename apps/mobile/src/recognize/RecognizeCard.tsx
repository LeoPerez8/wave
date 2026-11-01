import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import {
  LISTENING_WAVE,
  recognizeCardActionLabels,
  recognizeCardView,
  type RecognizeCard as RecognizeCardState,
  type RecognizeCardAction,
  type RecognizeSource,
  type RecognizeMatch,
} from "@wave/core";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AppState, Linking, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { Artwork } from "@/catalog/Artwork";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { NativeWaveUnderline } from "@/glass/waveGlass";
import type { SongRow } from "@/library/LibraryStore";
import { openAddToPlaylist } from "@/library/PlaylistSheets";
import { addToShazam } from "@/library/playlists";
import { openAlbum } from "@/library/routes";
import { recognizeNative } from "@/native/waveRecognize";
import { showError } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { MenuRow } from "@/overlay/MenuRow";
import { playSongs, playYtSongs, playNext, playYtNext } from "@/playback/actions";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { useLoadedInLibrary } from "@/ytmusic/libraryFinder";
import { cancelYtDownload, downloadYtSong, useYtDownloadStatus } from "@/ytmusic/YtDownloads";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { openOverlay } from "@/overlay/overlay";
import { useThemeColor } from "@/theme/useThemeColor";

import { resolveRecognitionSave } from "./resolveRecognitionSave";
import { hasMicrophone } from "./microphone";
import { createRecognizeEntry } from "./recognizeEntry";
import { recognizeDeps } from "./recognizeDeps";
import { startRecognizeSession, type RecognizeNative, type RecognizeRun } from "./recognizeSession";
import { cancelRecognizeTile, trackCardSession, recognizeTileResult } from "./startRecognizeTile";

const COVER = CELL * 9;
const WAVE_HEIGHT = LISTENING_WAVE.amplitude * 2 + LISTENING_WAVE.stroke;

/** Whether this build can recognize (its APK has the native half). */
export const recognizeAvailable = recognizeNative !== null;

/**
 * Opens the Recognize card, already listening (docs/spec.md, "Recognize"). The
 * Search field's Recognize Song button opens it; so can anything else that should
 * start listening at once (the tile and the app shortcut, #772). Closing the card,
 * by Cancel, Back or a tap outside, ends the session.
 */
const entry = createRecognizeEntry<NativeYtSong>({
  foreground: () => AppState.currentState === "active",
  cancelTile: cancelRecognizeTile,
  show: (opening, closed) => {
    const match = opening.kind === "match" ? opening.match : null;
    const source = opening.kind === "capture" ? opening.source : "auto";
    const native = recognizeNative;
    if (native === null) return closed();
    const handle = openOverlay({
      label: currentLocalisation().strings.playbackText.recognizeSong,
      render: (close) => (
        <RecognizeCard
          native={native}
          source={source}
          match={match}
          close={close}
          onClosed={closed}
        />
      ),
    });
    return handle.close;
  },
});

export const openRecognize = entry.request;
/** Flushes a launch request once Android has brought Wave into the foreground. */
export const resumeRecognizeEntry = entry.resume;

/**
 * The glass card: "Listening…" over the moving wave with Cancel, then the song
 * (cover, title, artist, album) or why there's none, with what can be done about it.
 * Each attempt (Try Again, or coming back from Android's settings with the
 * microphone allowed) runs a new session; leaving the card cancels the one running.
 */
function RecognizeCard({
  native,
  source: initialSource,
  match,
  close,
  onClosed,
}: {
  native: RecognizeNative;
  source: RecognizeSource | "auto";
  match: RecognizeMatch<NativeYtSong> | null;
  close: () => void;
  onClosed: () => void;
}) {
  const { strings } = useLocalisation();
  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState(initialSource);
  const [activeSource, setActiveSource] = useState<RecognizeSource | null>(
    initialSource === "auto" ? null : initialSource,
  );
  // The card for this attempt; an earlier attempt's end never shows over a new one.
  const [shown, setShown] = useState<{
    attempt: number;
    card: RecognizeCardState<SongRow, NativeYtSong>;
  }>({
    attempt: 0,
    card: match === null ? { kind: "listening" } : { kind: "resolving", song: match.song },
  });
  const run = useRef<RecognizeRun | null>(null);
  const closeFromEffect = useEffectEvent(close);

  useEffect(() => onClosed, [onClosed]);

  useEffect(() => {
    if (AppState.currentState !== "active") {
      closeFromEffect();
      return;
    }
    if (attempt === 0 && match !== null) {
      let current = true;
      void recognizeTileResult(match).then((result) => {
        if (current) setShown({ attempt, card: { kind: "resolved", result } });
      });
      return () => {
        current = false;
      };
    }
    // Listen Again and source changes on a result card also replace tile capture.
    if (attempt > 0) cancelRecognizeTile();
    const session = startRecognizeSession(
      recognizeDeps(native),
      source,
      (card) => {
        if (card.kind === "listening" && card.source !== undefined) setActiveSource(card.source);
        setShown({ attempt, card });
      },
      // The session cancelled itself because Wave was hidden as its capture stopped.
      () => closeFromEffect(),
    );
    run.current = session;
    trackCardSession(session);
    return () => session.cancel();
  }, [native, source, attempt, match]);

  const card: RecognizeCardState<SongRow, NativeYtSong> =
    shown.attempt === attempt ? shown.card : { kind: "listening" };

  const pickSource = (picked: RecognizeSource): void => {
    run.current?.cancel();
    setSource(picked);
    setActiveSource(picked);
    setAttempt((n) => n + 1);
  };

  // Leaving Wave stops capture, but Android's permission and consent dialogs only pause
  // it. A denied card stays for the settings round trip below.
  const listening = card.kind === "listening";
  useEffect(() => {
    if (!listening) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "background") return;
      if (run.current?.cancelOnBackground() === false) return;
      closeFromEffect();
    });
    return () => subscription.remove();
  }, [listening]);

  // Back from Android's settings with the microphone allowed: listen at once.
  const denied = card.kind === "denied";
  useEffect(() => {
    if (!denied) return undefined;
    let current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void hasMicrophone().then((granted) => {
        if (current && granted) setAttempt((n) => n + 1);
      });
    });
    return () => {
      current = false;
      subscription.remove();
    };
  }, [denied]);

  const ytMusic = useYtMusicEnabled();
  const result = card.kind === "resolved" ? card.result : null;
  const status = useYtDownloadStatus(result?.kind === "stream" ? result.song.videoId : "");
  const inLibrary = useLoadedInLibrary(result?.kind === "stream");
  const labels = recognizeCardActionLabels(strings);
  const view = recognizeCardView(
    card,
    {
      ytMusic,
      status,
      inLibrary: result?.kind === "stream" && inLibrary(result.song),
    },
    strings,
  );

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
      case "useMicrophone":
        pickSource("microphone");
        return;
      default:
        if (result === null || !view.actions.includes(action)) return;
        switch (action) {
          case "addToShazam":
            void resolveRecognitionSave(result)
              .then(addToShazam)
              .catch((error: unknown) => showError(strings.playbackText.couldntAddToShazam, error));
            return;
          case "addToPlaylist":
            openAddToPlaylist({
              title: result.song.title,
              songs: async () => [await resolveRecognitionSave(result)],
            });
            return;
          case "play":
            if (result.kind === "library") {
              close();
              void playSongs([result.track], 0, { kind: "search", id: null }).catch(
                (error: unknown) => showError(strings.playbackText.couldntPlayTheSong, error),
              );
            } else if (result.kind === "stream") {
              close();
              void playYtSongs([result.song], 0, { kind: "search", id: null }).catch(
                (error: unknown) => showError(strings.playbackText.couldntPlayTheSong, error),
              );
            }
            return;
          case "playNext":
            if (result.kind === "library")
              void playNext([result.track]).catch((error: unknown) =>
                showError(strings.playbackText.couldntQueueTheSong, error),
              );
            else if (result.kind === "stream")
              void playYtNext([result.song]).catch((error: unknown) =>
                showError(strings.playbackText.couldntQueueTheSong, error),
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
        <CatalogLine>{strings.playbackText.recognizeSong}</CatalogLine>
        <View className="flex-row rounded-full bg-fill" accessibilityRole="radiogroup">
          {(
            [
              ["microphone", strings.playbackText.aroundMe],
              ["playback", strings.playbackText.thisPhone],
            ] as const
          ).map(([pick, label]) => (
            <TextButton
              key={pick}
              label={label}
              variant="pill"
              tone="secondary"
              selected={activeSource === pick}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: activeSource === pick }}
              accessibilityHint={strings.playbackText.startsListeningAgainFromThisSource}
              haptic="selection"
              onPress={() => {
                if (pick !== activeSource) pickSource(pick);
              }}
              className="flex-1 items-center"
              labelProps={{ className: "font-sans text-subheadline font-semibold" }}
            />
          ))}
        </View>
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
                case "addToShazam":
                case "addToPlaylist":
                case "goToAlbum":
                case "download":
                case "retryDownload":
                case "cancelDownload":
                  return (
                    <MenuRow
                      key={action}
                      action={action}
                      label={labels[action]}
                      onPress={() => press(action)}
                    />
                  );
                default:
                  return null;
              }
            })}
          </CardEntries>
          <TextButton
            label={labels.listenAgain}
            onPress={() => press("listenAgain")}
            style={{ alignSelf: "flex-end" }}
          />
        </>
      ) : (
        <View className="flex-row items-center justify-end" style={{ gap: CELL * 3 }}>
          {view.actions.map((action) => (
            <TextButton key={action} label={labels[action]} onPress={() => press(action)} />
          ))}
        </View>
      )}
    </>
  );
}

/**
 * The moving wave, in the accent colour. It ripples on the RenderThread (a native
 * AnimatedVectorDrawable, as the playing song's underline does), so it never makes
 * the card's glass re-blur (issue #93); it lies still under reduce motion.
 */
function ListeningWave() {
  const accent = useThemeColor("accent");
  const reduceMotion = useReducedMotion();
  return (
    <NativeWaveUnderline
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      shape="listening"
      color={accent}
      animating={!reduceMotion}
      style={{ alignSelf: "stretch", height: WAVE_HEIGHT }}
    />
  );
}
