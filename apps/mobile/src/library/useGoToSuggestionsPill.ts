import {
  GO_TO_SUGGESTIONS_WAIT_MS,
  goToSuggestionsPillAfter,
  type GoToSuggestionsPill,
} from "@wave/core";
import { useCallback, useEffect } from "react";
import type { ScrollView } from "react-native";
import {
  cancelAnimation,
  ReduceMotion,
  useEvent,
  useSharedValue,
  withDelay,
  withTiming,
  type AnimatedRef,
  type ScrollEvent,
} from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";

const WAIT_ENDS = { duration: 0, reduceMotion: ReduceMotion.Never };

/**
 * Follows the owner's scrolling of the list at [scrollRef] for the Go to Suggestions pill, on the
 * UI thread: it listens as `useScrollOffset` does, since the list keeps its own `onScroll`. The
 * wait is a delayed animation that never moves anything, so it must ignore reduce motion, or the
 * pill would leave at once there.
 */
export function useGoToSuggestionsPill(scrollRef: AnimatedRef<ScrollView>) {
  const phase = useSharedValue<GoToSuggestionsPill>("hidden");
  const wait = useSharedValue(0);

  const onScrollEvent = useEvent<ScrollEvent>(
    (event: ScrollEvent) => {
      "worklet";
      const started = event.eventName.endsWith("onScrollBeginDrag");
      const ended = event.eventName.endsWith("onScrollEndDrag");
      const before = phase.get();
      const now = goToSuggestionsPillAfter(
        before,
        started ? "dragStarted" : ended ? "dragEnded" : "scrolled",
      );
      if (now !== before) phase.set(now);
      if (now === "dragging") cancelAnimation(wait);
      if (now !== "gliding") return;
      cancelAnimation(wait);
      wait.set(0);
      wait.set(
        withDelay(
          GO_TO_SUGGESTIONS_WAIT_MS,
          withTiming(1, WAIT_ENDS, (finished) => {
            if (finished !== true) return;
            wait.set(0);
            phase.set(goToSuggestionsPillAfter(phase.get(), "waited"));
          }),
          ReduceMotion.Never,
        ),
      );
    },
    ["onScroll", "onScrollBeginDrag", "onScrollEndDrag"],
  );

  useEffect(() => {
    const stopObserving = scrollRef.observe((tag) => {
      if (tag === null) return;
      const handler = registeredHandler(onScrollEvent);
      handler?.registerForEvents(tag);
      return () => handler?.unregisterFromEvents(tag);
    });
    return () => stopObserving?.();
  }, [scrollRef, onScrollEvent]);

  const tapped = useCallback(() => {
    scheduleOnUI(() => {
      "worklet";
      phase.set(goToSuggestionsPillAfter(phase.get(), "tapped"));
    });
  }, [phase]);

  return { phase, tapped };
}

/** What `useEvent` returns holds this, as `useScrollOffset` reads it; its type doesn't say so. */
type EventRegistration = {
  registerForEvents(tag: number): void;
  unregisterFromEvents(tag: number): void;
};

const registeredHandler = (event: unknown): EventRegistration | null => {
  if (typeof event !== "object" && typeof event !== "function") return null;
  if (event === null || !("workletEventHandler" in event)) return null;
  const handler = event.workletEventHandler;
  return typeof handler === "object" &&
    handler !== null &&
    "registerForEvents" in handler &&
    typeof handler.registerForEvents === "function" &&
    "unregisterFromEvents" in handler &&
    typeof handler.unregisterFromEvents === "function"
    ? (handler as EventRegistration)
    : null;
};
