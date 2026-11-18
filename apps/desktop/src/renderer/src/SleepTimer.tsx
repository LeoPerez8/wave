/**
 * The player bar's Sleep Timer (docs/spec.md, Sleep timer): a menu of the phone's presets, End of
 * Track, End of Queue and a custom duration. Core holds the rules and main enforces them; the
 * button shows what is left while a timer runs.
 */
import {
  CUSTOM_SLEEP_MINUTES,
  formatSleepMinutes,
  formatSleepRemaining,
  SLEEP_TIMER_PRESETS,
  sleepTimerEntryLabel,
  sleepTimerLabelChangesIn,
  stepSleepMinutes,
  type SleepTimer as Timer,
  type SleepTimerChoice,
} from "@wave/core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Icon } from "./Icon.tsx";
import { Menu, type MenuItem } from "./Menu.tsx";
import { text } from "./text.ts";

/** The button's short label: the countdown, or End of track/queue. */
const leftOf = (timer: Timer, now: number) =>
  timer.type === "endOfTrack"
    ? text.playbackText.endOfTrack2
    : timer.type === "endOfQueue"
      ? text.playbackText.endOfQueue2
      : formatSleepRemaining(Math.max(0, timer.endsAt - now));

/** The clock a deadline's label reads, moved on each time the label shows one second less. */
function useNow(timer: Timer | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (timer === null) return;
    const at = Date.now();
    const changesIn = sleepTimerLabelChangesIn(timer, at);
    if (changesIn === null) return;
    // A timer started since the clock last moved reads it again at once.
    const handle = setTimeout(() => setNow(Date.now()), at - now >= 1000 ? 0 : changesIn + 5);
    return () => clearTimeout(handle);
  }, [timer, now]);
  return now;
}

/** The custom duration: Shorter and Longer step it as on the phone. */
function CustomDuration({
  onStart,
  onClose,
}: {
  readonly onStart: (minutes: number) => void;
  readonly onClose: () => void;
}) {
  const [minutes, setMinutes] = useState<number>(CUSTOM_SLEEP_MINUTES.initial);
  const words = text.playbackText;
  const key = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Tab") {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("button")];
      const at = buttons.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  };
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog sleep-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sleep-title"
        aria-describedby="sleep-left"
        onKeyDown={key}
      >
        <h2 id="sleep-title">{words.pauseAfter}</h2>
        <div className="sleep-stepper">
          <button
            disabled={minutes <= CUSTOM_SLEEP_MINUTES.min}
            onClick={() => setMinutes((value) => stepSleepMinutes(value, -1))}
          >
            {words.shorter}
          </button>
          <output id="sleep-left" aria-live="polite">
            {formatSleepMinutes(minutes, text)}
          </output>
          <button
            disabled={minutes >= CUSTOM_SLEEP_MINUTES.max}
            onClick={() => setMinutes((value) => stepSleepMinutes(value, 1))}
          >
            {words.longer}
          </button>
        </div>
        <div className="dialog-buttons">
          <button onClick={onClose}>{words.cancel}</button>
          <button className="accent" autoFocus onClick={() => onStart(minutes)}>
            {words.startTimer}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SleepTimer({
  timer,
  disabled,
  run,
}: {
  readonly timer: Timer | null;
  readonly disabled: boolean;
  readonly run: (action: Promise<unknown>) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [custom, setCustom] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const now = useNow(timer);
  const words = text.playbackText;
  const label = sleepTimerEntryLabel(timer, now, text);
  const start = (choice: SleepTimerChoice | null) =>
    run(window.wave.playback.setSleepTimer(choice));
  const items: MenuItem[] = [
    ...SLEEP_TIMER_PRESETS.map((minutes) => ({
      key: `minutes-${minutes}`,
      label: words.valueMinutes(minutes),
      run: () => start({ type: "minutes", minutes }),
    })),
    { key: "custom", label: words.custom, run: () => setCustom(true) },
    { key: "endOfTrack", label: words.endOfTrack, run: () => start({ type: "endOfTrack" }) },
    { key: "endOfQueue", label: words.endOfQueue, run: () => start({ type: "endOfQueue" }) },
    ...(timer === null
      ? []
      : [{ key: "off", label: words.turnOffTimer, destructive: true, run: () => start(null) }]),
  ];
  const close = () => {
    setCustom(false);
    button.current?.focus();
  };
  return (
    <>
      <button
        ref={button}
        className="icon-button sleep-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-pressed={timer !== null}
        disabled={disabled && timer === null}
        onClick={() => {
          const rect = button.current!.getBoundingClientRect();
          setMenu({ x: rect.left, y: rect.top });
        }}
      >
        <Icon name="sleep" />
        {timer !== null && (
          <span className="sleep-left" aria-hidden="true">
            {leftOf(timer, now)}
          </span>
        )}
      </button>
      {menu !== null && (
        <Menu label={words.sleepTimer} items={items} at={menu} onClose={() => setMenu(null)} />
      )}
      {custom && (
        <CustomDuration
          onClose={close}
          onStart={(minutes) => {
            close();
            start({ type: "minutes", minutes });
          }}
        />
      )}
    </>
  );
}
