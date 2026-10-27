import { IconMinus, IconPlus, IconZzz } from "@tabler/icons-react-native";
import {
  CUSTOM_SLEEP_MINUTES,
  SLEEP_TIMER_PRESETS,
  entryDivider,
  formatSleepMinutes,
  formatSleepRemaining,
  sleepTimerRemaining,
  sleepTimerLabelSeconds,
  stepSleepMinutes,
  type SleepTimer,
  type SleepTimerChoice,
} from "@wave/core";
import { useCallback, useState, useSyncExternalStore } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import {
  createAnimatedComponent,
  useAnimatedProps,
  useAnimatedReaction,
  useDerivedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { withUniwind } from "uniwind";

import { CatalogLine } from "@/catalog/CatalogLine";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { IconButton } from "@/components/IconButton";
import { TextButton } from "@/components/TextButton";
import { Press } from "@/motion/Press";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";
import { cancelSleepTimer, setSleepTimer } from "@/playback/actions";
import { useRenderCount } from "@/perf/perf";
import { playbackState, sleepTimerState } from "@/playback/Player";
import { useThemeColor } from "@/theme/useThemeColor";

import { isPlayheadLive, playhead } from "./playhead";

const AnimatedTextInput = withUniwind(createAnimatedComponent(TextInput));

const useSleepTimer = (): SleepTimer | null =>
  useSyncExternalStore(sleepTimerState.subscribe, sleepTimerState.get);

/** Only changed whole seconds cross to React. End of track never schedules a callback. */
const useRemaining = (timer: SleepTimer): number | null => {
  const [seconds, setSeconds] = useState(() => sleepTimerLabelSeconds(timer, Date.now()));
  const publish = useCallback(
    (next: number) => {
      if (isPlayheadLive() && sleepTimerState.get() === timer) setSeconds(next);
    },
    [timer],
  );
  useAnimatedReaction(
    () =>
      timer.type === "deadline" && playhead.live.get()
        ? sleepTimerLabelSeconds(timer, playhead.now.get())
        : null,
    (next, previous) => {
      if (next !== null && next !== previous) scheduleOnRN(publish, next);
    },
  );
  return seconds === null ? null : seconds * 1000;
};

/** The time left beside the glyph, in teal. */
function ButtonLabel({ timer }: { timer: SleepTimer }) {
  useRenderCount("SleepTimerLabel");
  const remaining = useRemaining(timer);
  return (
    <Text
      numberOfLines={1}
      className="font-sans text-footnote text-accent"
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {timer.type === "endOfTrack" ? "End of track" : formatSleepRemaining(remaining ?? 0)}
    </Text>
  );
}

/** What the running timer will do, and when. */
function Status({ timer }: { timer: SleepTimer }) {
  const remaining = useRemaining(timer);
  if (timer.type === "endOfTrack") return <EndOfTrackStatus />;
  const text = `Pauses in ${formatSleepRemaining(remaining ?? 0)}`;
  return (
    <Text
      className="font-sans text-subheadline text-foreground"
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {text}
    </Text>
  );
}

/** Keep the menu's track countdown on the UI thread too; the button still says End of track. */
function EndOfTrackStatus() {
  const status = useDerivedValue(() => {
    const remaining = sleepTimerRemaining(
      { type: "endOfTrack" },
      {
        now: playhead.now.get(),
        positionMs: playhead.positionMs.get(),
        durationMs: playhead.durationMs.get(),
      },
    );
    return remaining === null
      ? "Pauses when this track ends"
      : `Pauses when this track ends, in ${formatSleepRemaining(remaining)}`;
  });
  const animatedProps = useAnimatedProps(() => {
    const text = status.get();
    return { text, defaultValue: text, accessibilityLabel: text } as TextInputProps;
  });
  const state = playbackState.get();
  const remaining = sleepTimerRemaining(
    { type: "endOfTrack" },
    {
      now: state.at,
      positionMs: state.positionMs,
      durationMs: state.durationMs,
    },
  );
  const initial =
    remaining === null
      ? "Pauses when this track ends"
      : `Pauses when this track ends, in ${formatSleepRemaining(remaining)}`;
  return (
    <View>
      <Text
        accessible={false}
        className="font-sans text-subheadline text-foreground"
        style={{ opacity: 0 }}
      >
        {initial}
      </Text>
      <AnimatedTextInput
        editable={false}
        accessibilityRole="text"
        pointerEvents="none"
        multiline
        underlineColorAndroid="transparent"
        defaultValue={initial}
        animatedProps={animatedProps}
        className="font-sans text-subheadline text-foreground"
        style={[
          StyleSheet.absoluteFill,
          { padding: 0, margin: 0, textAlignVertical: "top", fontVariant: ["tabular-nums"] },
        ]}
      />
    </View>
  );
}

/**
 * The timer menu: 15/30/45/60 minutes, a custom duration, end of track, and
 * Turn Off while one runs. A glass card on the overlay, laid out like the
 * long-press menu.
 */
function SleepTimerMenu({ close }: { close: () => void }) {
  const timer = useSleepTimer();
  const [custom, setCustom] = useState(false);
  const [minutes, setMinutes] = useState<number>(CUSTOM_SLEEP_MINUTES.initial);
  const flow = useOverlayFlow();

  const pick = (choice: SleepTimerChoice) => {
    setSleepTimer(choice);
    close();
  };

  const turnOff = () => {
    cancelSleepTimer();
    close();
  };

  const entries: readonly { label: string; onPress: () => void }[] = [
    ...SLEEP_TIMER_PRESETS.map((preset) => ({
      label: `${preset} Minutes`,
      onPress: () => pick({ type: "minutes", minutes: preset }),
    })),
    { label: "Custom…", onPress: () => setCustom(true) },
    { label: "End of Track", onPress: () => pick({ type: "endOfTrack" }) },
    ...(timer === null ? [] : [{ label: "Turn Off Timer", onPress: turnOff }]),
  ];

  return (
    <>
      <View style={{ paddingBottom: CELL * 2, gap: CELL / 2 }}>
        <CatalogLine tone={timer === null ? "secondary" : "accent"}>Sleep timer</CatalogLine>
        {timer === null ? (
          <Text className="font-sans text-subheadline text-secondary">
            Pause playback after a while, or when this track ends.
          </Text>
        ) : (
          <Status key={timer.type === "deadline" ? timer.endsAt : timer.type} timer={timer} />
        )}
      </View>
      <Hairline />
      {custom ? (
        <>
          <View style={{ paddingVertical: CELL }}>
            <Text className="font-sans text-title3 font-normal text-foreground">Pause After</Text>
            <View className="flex-row items-center justify-center" style={{ minHeight: grid.row }}>
              <IconButton
                icon={IconMinus}
                label="Shorter"
                disabled={minutes <= CUSTOM_SLEEP_MINUTES.min}
                onPress={() => setMinutes((current) => stepSleepMinutes(current, -1))}
              />
              <Text
                accessibilityLiveRegion="polite"
                className="text-center font-sans text-body font-medium text-foreground"
                numberOfLines={1}
                style={{ minWidth: CELL * 12, fontVariant: ["tabular-nums"] }}
              >
                {formatSleepMinutes(minutes)}
              </Text>
              <IconButton
                icon={IconPlus}
                label="Longer"
                disabled={minutes >= CUSTOM_SLEEP_MINUTES.max}
                onPress={() => setMinutes((current) => stepSleepMinutes(current, 1))}
              />
            </View>
          </View>
          <Hairline />
          <View className="flex-row items-center justify-between">
            <TextButton label="Back" onPress={() => setCustom(false)} />
            <TextButton label="Start Timer" onPress={() => pick({ type: "minutes", minutes })} />
          </View>
        </>
      ) : (
        <CardEntries>
          {entries.map((entry, index) => (
            <EntryRow
              key={entry.label}
              label={entry.label}
              onPress={entry.onPress}
              divider={entryDivider(index, entries.length, flow)}
            />
          ))}
        </CardEntries>
      )}
    </>
  );
}

/** Opens the timer menu over everything, Now Playing included, next to its button. */
const openSleepTimer = (): void => {
  openOverlay({
    label: "Sleep timer",
    anchor: pressedRect(),
    render: (close) => <SleepTimerMenu close={close} />,
  });
};

/**
 * Now Playing's sleep timer control: the Zzz glyph (teal while a timer runs,
 * with the time left beside it) that opens the timer menu.
 */
export function SleepTimerButton() {
  const timer = useSleepTimer();
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel="Sleep timer"
      accessibilityValue={{
        text: timer === null ? "Off" : timer.type === "endOfTrack" ? "End of track" : "On",
      }}
      onPress={openSleepTimer}
      opensMenu
      haptic="selection"
      depth={0.1}
      className="flex-row items-center"
      style={{ height: CELL * 6, paddingRight: timer === null ? 0 : CELL }}
    >
      <View className="items-center justify-center" style={{ width: CELL * 6, height: CELL * 6 }}>
        <IconZzz size={24} color={timer === null ? secondary : accent} strokeWidth={1.5} />
      </View>
      {timer !== null && (
        <ButtonLabel key={timer.type === "deadline" ? timer.endsAt : timer.type} timer={timer} />
      )}
    </Press>
  );
}
