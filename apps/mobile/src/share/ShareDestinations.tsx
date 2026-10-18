import type { ComponentType } from "react";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

/** One place a shared image can go: Save image, More, and (#406) Instagram Stories, WhatsApp. */
export interface ShareDestination {
  readonly key: string;
  readonly label: string;
  readonly icon: ComponentType<IconProps>;
  readonly onPress: () => void;
}

/** A destination's round button, its icon in ink on the fill. */
const BUTTON = CELL * 7;

/**
 * The row of destinations under a share preview, in the order given (the
 * caller puts app destinations first, as Spotify does). `disabled` while an
 * image is on its way, so one tap sends one image.
 */
export function ShareDestinations({
  destinations,
  disabled = false,
}: {
  destinations: readonly ShareDestination[];
  disabled?: boolean;
}) {
  const foreground = useThemeColor("foreground");
  const tertiary = useThemeColor("tertiary");
  return (
    <View className="flex-row justify-center" style={{ gap: CELL * 3 }}>
      {destinations.map(({ key, label, icon: Icon, onPress }) => (
        <Press
          key={key}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPress}
          haptic="selection"
          depth={0.06}
          className="items-center"
          style={{ width: BUTTON + CELL * 3, gap: CELL }}
        >
          <View
            className="items-center justify-center rounded-full bg-fill"
            style={{ width: BUTTON, height: BUTTON }}
          >
            <Icon size={26} color={disabled ? tertiary : foreground} strokeWidth={1.5} />
          </View>
          <Text
            numberOfLines={2}
            className={`text-center font-sans text-caption ${disabled ? "text-tertiary" : "text-secondary"}`}
          >
            {label}
          </Text>
        </Press>
      ))}
    </View>
  );
}
