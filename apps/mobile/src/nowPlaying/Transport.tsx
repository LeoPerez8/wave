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
 * Music. In edit mode ([editing]) the three dim and take no touches, and
 * screen readers skip them.
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
        <IconButton
          tone="primary"
          haptic="impact"
          icon={IconPlayerTrackPrevFilled}
          label={strings.playbackText.previousTrack}
          onPress={skipToPrevious}
          iconSize={CELL * 4}
          size={CELL * 7}
        />
        <IconButton
          tone="primary"
          haptic="impact"
          icon={playing ? IconPlayerPauseFilled : IconPlayerPlayFilled}
          label={playing ? strings.playbackText.pause : strings.playbackText.play}
          onPress={togglePlayPause}
          iconSize={CELL * 6}
          size={CELL * 9}
        />
        <IconButton
          tone="primary"
          haptic="impact"
          icon={IconPlayerTrackNextFilled}
          label={strings.playbackText.nextTrack}
          onPress={skipToNext}
          iconSize={CELL * 4}
          size={CELL * 7}
        />
      </View>
      <TransportSlot>{right}</TransportSlot>
    </View>
  );
}
