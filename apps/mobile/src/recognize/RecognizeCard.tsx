import {
  LISTENING_WAVE,
  RECOGNIZE_CARD_ACTION_LABELS,
  recognizeCardView,
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
import { appLog } from "@/log/appLog";
import { online } from "@/native/waveNative";
import { recognizeNative } from "@/native/waveRecognize";
import { openOverlay } from "@/overlay/overlay";
import { holdPlayback } from "@/playback/holdPlayback";
import { useTapAnimationMs } from "@/settings/tapAnimation";
import { useThemeColor } from "@/theme/useThemeColor";

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

const depsFor = (native: RecognizeNative): RecognizeDeps => ({
  online,
  microphone: microphonePermission,
  holdPlayback,
  native,
  log: (level, line) => appLog(level, "WaveRecognize", line),
});

/**
 * Opens the Recognize card, already listening (docs/spec.md, "Recognize"). The
 * Search field's Recognize Song button opens it; so can anything else that should
 * start listening at once (the tile and the app shortcut, #772). Closing the card,
 * by Cancel, Back or a tap outside, ends the session.
 */
export const openRecognize = (source: RecognizeSource | "auto" = "auto"): void => {
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
  source: initialSource,
  close,
}: {
  native: RecognizeNative;
  source: RecognizeSource | "auto";
  close: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState(initialSource);
  const [activeSource, setActiveSource] = useState<RecognizeSource | null>(
    initialSource === "auto" ? null : initialSource,
  );
  // The card for this attempt; an earlier attempt's end never shows over a new one.
  const [shown, setShown] = useState<{ attempt: number; card: RecognizeCardState }>({
    attempt: 0,
    card: { kind: "listening" },
  });
  const run = useRef<RecognizeRun | null>(null);

  useEffect(() => {
    const session = startRecognizeSession(depsFor(native), source, (card) => {
      if (card.kind === "listening" && card.source !== undefined) setActiveSource(card.source);
      setShown({ attempt, card });
    });
    run.current = session;
    return () => session.cancel();
  }, [native, source, attempt]);

  const card: RecognizeCardState = shown.attempt === attempt ? shown.card : { kind: "listening" };

  const pickSource = (picked: RecognizeSource): void => {
    run.current?.cancel();
    setSource(picked);
    setActiveSource(picked);
    setAttempt((n) => n + 1);
  };

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
      case "tryAgain":
        setAttempt((n) => n + 1);
        return;
      case "openSettings":
        void Linking.openSettings().catch(() => undefined);
        return;
      case "useMicrophone":
        pickSource("microphone");
        return;
    }
  };

  const view = recognizeCardView(card);
  return (
    <>
      <View style={{ paddingTop: CELL, paddingBottom: CELL * 2, gap: CELL * 1.5 }}>
        <CatalogLine>Recognize Song</CatalogLine>
        <View className="flex-row rounded-full bg-fill" accessibilityRole="radiogroup">
          {(
            [
              ["microphone", "Around me"],
              ["playback", "This phone"],
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
              accessibilityHint="Starts listening again from this source"
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
      <View className="flex-row items-center justify-end" style={{ gap: CELL * 3 }}>
        {view.actions.map((action) => (
          <TextButton
            key={action}
            label={RECOGNIZE_CARD_ACTION_LABELS[action]}
            onPress={() => press(action)}
          />
        ))}
      </View>
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
