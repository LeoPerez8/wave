import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerTrackNextFilled,
  IconPlayerTrackPrevFilled,
} from "@tabler/icons-react-native";
import type { ComponentType } from "react";
import { useSyncExternalStore } from "react";
import { View } from "react-native";

import { CELL } from "@/catalog/grid";
import { Press } from "@/motion/Press";
import { skipToNext, skipToPrevious, togglePlayPause } from "@/playback/actions";
import { playbackState } from "@/playback/Player";
import { useThemeColor } from "@/theme/useThemeColor";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

type GlyphProps = {
  icon: ComponentType<IconProps>;
  label: string;
  onPress: () => void;
  /** Drawn glyph size; the target is a cell and a half larger on every side. */
  size: number;
};

/** A transport glyph in ink: the screen's main controls, so they speak louder than teal. */
function Glyph({ icon: Icon, label, onPress, size }: GlyphProps) {
  const foreground = useThemeColor("foreground");
  const target = size + CELL * 3;
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      haptic="impact"
      depth={0.1}
      className="items-center justify-center"
      style={{ width: target, height: target }}
    >
      <Icon size={size} color={foreground} />
    </Press>
  );
}

/**
 * Previous, play/pause and next. Previous restarts the track after its first
 * three seconds (Core's queue engine decides), like Apple Music.
 */
export function Transport() {
  const playing = useSyncExternalStore(
    playbackState.subscribe,
    () => playbackState.get().playWhenReady,
  );
  return (
    <View className="flex-row items-center justify-center" style={{ gap: CELL * 3 }}>
      <Glyph
        icon={IconPlayerTrackPrevFilled}
        label="Previous track"
        onPress={skipToPrevious}
        size={CELL * 4}
      />
      <Glyph
        icon={playing ? IconPlayerPauseFilled : IconPlayerPlayFilled}
        label={playing ? "Pause" : "Play"}
        onPress={togglePlayPause}
        size={CELL * 6}
      />
      <Glyph
        icon={IconPlayerTrackNextFilled}
        label="Next track"
        onPress={skipToNext}
        size={CELL * 4}
      />
    </View>
  );
}
