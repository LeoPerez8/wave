import { IconMinus, IconPlus, IconZzz } from "@tabler/icons-react-native";
import {
  CUSTOM_SLEEP_MINUTES,
  SLEEP_TIMER_PRESETS,
  formatSleepMinutes,
  formatSleepRemaining,
  sleepTimerRemaining,
  stepSleepMinutes,
  type SleepTimer,
  type SleepTimerChoice,
} from "@wave/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CatalogLine } from "@/catalog/CatalogLine";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { IconButton } from "@/components/IconButton";
import { TextButton } from "@/components/TextButton";
import { Press } from "@/motion/Press";
import { cancelSleepTimer, setSleepTimer } from "@/playback/actions";
import { sleepTimerState } from "@/playback/Player";
import { useThemeColor } from "@/theme/useThemeColor";

import { usePlayhead } from "./hooks";

/** How often a deadline's countdown re-reads the clock (it shows whole seconds). */
const TICK_MS = 250;

const useSleepTimer = (): SleepTimer | null =>
  useSyncExternalStore(sleepTimerState.subscribe, sleepTimerState.get);

/** Time left on a running timer: on the clock for a deadline, on the playhead for end of track. */
const useRemaining = (timer: SleepTimer): number | null => {
  const playhead = usePlayhead();
  const [now, setNow] = useState(Date.now);
  const onClock = timer.type === "deadline";
  useEffect(() => {
    if (!onClock) return undefined;
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, [onClock]);
  return sleepTimerRemaining(timer, { now, ...playhead });
};

/** The time left beside the glyph, in teal. */
function ButtonLabel({ timer }: { timer: SleepTimer }) {
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
  const text =
    timer.type === "deadline"
      ? `Pauses in ${formatSleepRemaining(remaining ?? 0)}`
      : remaining === null
        ? "Pauses when this track ends"
        : `Pauses when this track ends, in ${formatSleepRemaining(remaining)}`;
  return (
    <Text
      className="font-sans text-subheadline text-foreground"
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {text}
    </Text>
  );
}

type SheetProps = { visible: boolean; timer: SleepTimer | null; onClose: () => void };

/**
 * The timer menu: 15/30/45/60 minutes, a custom duration, end of track, and
 * Turn Off while one runs. Laid out like the long-press menu: flat, on the
 * ground, over a 90% ground veil.
 */
function SleepTimerSheet({ visible, timer, onClose }: SheetProps) {
  const insets = useSafeAreaInsets();
  const [custom, setCustom] = useState(false);
  const [minutes, setMinutes] = useState<number>(CUSTOM_SLEEP_MINUTES.initial);

  const close = () => {
    setCustom(false);
    onClose();
  };

  const pick = (choice: SleepTimerChoice) => {
    setSleepTimer(choice);
    close();
  };

  const turnOff = () => {
    cancelSleepTimer();
    close();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <Pressable
        className="flex-1 bg-background/90"
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={close}
      />
      <View
        className="bg-background"
        style={{ paddingHorizontal: grid.margin, paddingBottom: insets.bottom + CELL * 2 }}
      >
        <Hairline />
        <View style={{ paddingVertical: CELL * 2, gap: CELL / 2 }}>
          <CatalogLine tone={timer === null ? "secondary" : "accent"}>Sleep timer</CatalogLine>
          {timer === null ? (
            <Text className="font-sans text-subheadline text-secondary">
              Pause playback after a while, or when this track ends.
            </Text>
          ) : (
            <Status timer={timer} />
          )}
        </View>
        <Hairline />
        {custom ? (
          <>
            <View className="flex-row items-center" style={{ minHeight: grid.row }}>
              <Text className="flex-1 font-sans text-title3 font-normal text-foreground">
                Pause After
              </Text>
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
            <Hairline />
            <View className="flex-row items-center justify-between">
              <TextButton label="Back" onPress={() => setCustom(false)} />
              <TextButton label="Start Timer" onPress={() => pick({ type: "minutes", minutes })} />
            </View>
          </>
        ) : (
          <>
            {SLEEP_TIMER_PRESETS.map((preset) => (
              <EntryRow
                key={preset}
                label={`${preset} Minutes`}
                onPress={() => pick({ type: "minutes", minutes: preset })}
              />
            ))}
            <EntryRow label="Custom…" onPress={() => setCustom(true)} />
            <EntryRow label="End of Track" onPress={() => pick({ type: "endOfTrack" })} />
            {timer !== null && <EntryRow label="Turn Off Timer" onPress={turnOff} />}
          </>
        )}
      </View>
    </Modal>
  );
}

/**
 * Now Playing's sleep timer control: the Zzz glyph (teal while a timer runs,
 * with the time left beside it) that opens the timer menu.
 */
export function SleepTimerButton() {
  const timer = useSleepTimer();
  const [open, setOpen] = useState(false);
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  return (
    <>
      <Press
        accessibilityRole="button"
        accessibilityLabel="Sleep timer"
        accessibilityValue={{
          text: timer === null ? "Off" : timer.type === "endOfTrack" ? "End of track" : "On",
        }}
        onPress={() => setOpen(true)}
        haptic="selection"
        depth={0.1}
        className="flex-row items-center"
        style={{ height: CELL * 6, paddingRight: timer === null ? 0 : CELL }}
      >
        <View className="items-center justify-center" style={{ width: CELL * 6, height: CELL * 6 }}>
          <IconZzz size={24} color={timer === null ? secondary : accent} strokeWidth={1.5} />
        </View>
        {timer !== null && <ButtonLabel timer={timer} />}
      </Press>
      <SleepTimerSheet visible={open} timer={timer} onClose={() => setOpen(false)} />
    </>
  );
}
