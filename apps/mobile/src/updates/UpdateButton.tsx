import { IconRefresh } from "@tabler/icons-react-native";
import { useEffect } from "react";
import { Text } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { IconButton } from "@/components/IconButton";
import { useLocalisation } from "@/localisation/localisation";

import { tapUpdateButton, useOfferedAppUpdate, useUpdateButtonLook } from "./appUpdates";

const SPIN_MS = 1000;
const ICON_SIZE = 18;

/** The refresh glyph, turning while a check runs. */
function Spinner({ spinning, color }: { spinning: boolean; color: string }) {
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (!spinning || reduceMotion) return;
    turn.set(0);
    turn.set(withRepeat(withTiming(360, { duration: SPIN_MS, easing: Easing.linear }), -1));
    return () => {
      cancelAnimation(turn);
      turn.set(0);
    };
  }, [spinning, reduceMotion, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get()}deg` }] }));
  return (
    <Animated.View style={style}>
      <IconRefresh size={ICON_SIZE} color={color} strokeWidth={1.5} />
    </Animated.View>
  );
}

/**
 * Beside the version in Settings: installs a downloaded APK, even one swiped off the pill, and
 * otherwise looks for an update now. Core's update policy says what a tap does.
 */
export function UpdateButton() {
  const { strings } = useLocalisation();
  const text = strings.appUpdates;
  const offered = useOfferedAppUpdate();
  const look = useUpdateButtonLook();
  const downloading = typeof look === "number";
  const label = downloading
    ? text.downloading(look)
    : offered !== null
      ? text.updateTheApp
      : text.checkForUpdates;
  return (
    <IconButton label={label} busy={look !== "idle"} onPress={tapUpdateButton}>
      {(color) =>
        downloading ? (
          <Text className="font-sans text-footnote" style={{ color }}>
            {text.percent(look)}
          </Text>
        ) : (
          <Spinner spinning={look === "checking"} color={color} />
        )
      }
    </IconButton>
  );
}
