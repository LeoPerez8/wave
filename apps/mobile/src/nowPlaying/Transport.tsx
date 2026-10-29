import { useLocalisation } from "@/localisation/localisation";
import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerTrackNextFilled,
  IconPlayerTrackPrevFilled,
} from "@tabler/icons-react-native";
import { useSyncExternalStore } from "react";
import { View } from "react-native";

import { CELL } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import { skipToNext, skipToPrevious, togglePlayPause } from "@/playback/actions";
import { playbackState } from "@/playback/Player";

/**
 * Previous, play/pause and next. Previous restarts the track after its first
 * three seconds (Core's queue engine decides), like Apple Music.
 */
export function Transport() {
  const { strings } = useLocalisation();
  const playing = useSyncExternalStore(
    playbackState.subscribe,
    () => playbackState.get().playWhenReady,
  );
  return (
    <View className="flex-row items-center justify-center" style={{ gap: CELL * 3 }}>
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
  );
}
