import { useLocalisation } from "@/localisation/localisation";
import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerTrackNextFilled,
  IconPlayerTrackPrevFilled,
} from "@tabler/icons-react-native";
import { useSyncExternalStore, type ReactNode } from "react";
import { View } from "react-native";

import { CELL } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import { skipToNext, skipToPrevious, togglePlayPause } from "@/playback/actions";
import { playbackState } from "@/playback/Player";

import { HoldSkipLabel, restartFromHold, useHoldSkip } from "./HoldSkip";

/** How much of the player shows through while its slots are edited. */
export const EDITING_OPACITY = 0.45;

/** A transport slot's place: the size of a slot's button, kept while the slot is empty. */
const SLOT = CELL * 6;

/**
 * A transport slot: its button ([children]), or nothing. Empty, it draws
 * nothing and takes no touches, and still holds its place, so Previous,
 * Play and Next stay where they are.
 */
function TransportSlot({ children }: { children: ReactNode }) {
  return (
    <View
      className="items-center justify-center"
      style={{ width: SLOT, height: SLOT }}
      pointerEvents={children == null ? "none" : "box-none"}
    >
      {children}
    </View>
  );
}

/**
 * Previous, play/pause and next, with a slot on each side ([left], [right]:
 * the slot's button, or null while it's empty). Previous restarts the track
 * after its first three seconds (Core's queue engine decides), like Apple
 * Music. Held (story 38d), play/pause starts the song over and Previous /
 * Next jump 5 seconds back / forward while the finger stays down, with the
 * total over the button; screen readers get these as actions. In edit mode
 * ([editing]) the three dim and take no touches, and screen readers skip them.
 */
export function Transport({
  left,
  right,
  editing,
}: {
  left: ReactNode;
  right: ReactNode;
  editing: boolean;
}) {
  const { strings } = useLocalisation();
  const playing = useSyncExternalStore(
    playbackState.subscribe,
    () => playbackState.get().playWhenReady,
  );
  const back = useHoldSkip("back");
  const forward = useHoldSkip("forward");
  return (
    <View className="flex-row items-center justify-between">
      <TransportSlot>{left}</TransportSlot>
      <View
        className="flex-row items-center justify-center"
        style={{ gap: CELL * 3, opacity: editing ? EDITING_OPACITY : 1 }}
        pointerEvents={editing ? "none" : "auto"}
        importantForAccessibility={editing ? "no-hide-descendants" : "auto"}
        accessibilityElementsHidden={editing}
      >
        <View>
          <HoldSkipLabel direction="back" state={back.label} />
          <IconButton
            tone="primary"
            haptic="impact"
            icon={IconPlayerTrackPrevFilled}
            label={strings.playbackText.previousTrack}
            onPress={skipToPrevious}
            {...back.press}
            accessibilityActions={[
              { name: "holdSkip", label: strings.playbackText.backFiveSeconds },
            ]}
            onAccessibilityAction={() => back.once()}
            iconSize={CELL * 4}
            size={CELL * 7}
          />
        </View>
        <IconButton
          tone="primary"
          haptic="impact"
          icon={playing ? IconPlayerPauseFilled : IconPlayerPlayFilled}
          label={playing ? strings.playbackText.pause : strings.playbackText.play}
          onPress={togglePlayPause}
          onLongPress={restartFromHold}
          accessibilityActions={[{ name: "restart", label: strings.playbackText.restartTheSong }]}
          onAccessibilityAction={restartFromHold}
          iconSize={CELL * 6}
          size={CELL * 9}
        />
        <View>
          <HoldSkipLabel direction="forward" state={forward.label} />
          <IconButton
            tone="primary"
            haptic="impact"
            icon={IconPlayerTrackNextFilled}
            label={strings.playbackText.nextTrack}
            onPress={skipToNext}
            {...forward.press}
            accessibilityActions={[
              { name: "holdSkip", label: strings.playbackText.forwardFiveSeconds },
            ]}
            onAccessibilityAction={() => forward.once()}
            iconSize={CELL * 4}
            size={CELL * 7}
          />
        </View>
      </View>
      <TransportSlot>{right}</TransportSlot>
    </View>
  );
}
