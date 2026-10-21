import type { ComponentType } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

/**
 * One place a share can go: Save image, More, Instagram Stories, WhatsApp,
 * and a song's link options (Copy Link, Spotify, YT Music).
 */
export interface ShareDestination {
  readonly key: string;
  readonly label: string;
  readonly icon: ComponentType<IconProps>;
  readonly onPress: () => void;
  /** This one alone can't be pressed (a link option with no link). */
  readonly disabled?: boolean;
  /** A spinner in place of the icon while what it shares loads. */
  readonly loading?: boolean;
  /** Why it's disabled ("Offline", "No Match"), under its label. */
  readonly note?: string | null;
}

/** A destination's round button, its icon in ink on the fill. */
const BUTTON = CELL * 7;

/**
 * The row of destinations under a share preview, in the order given (the
 * caller puts app destinations first, as Spotify does), centred, scrolling
 * sideways when they don't fit. `disabled` while an image is on its way, so
 * one tap sends one image.
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
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: CELL * 3 }}
    >
      {destinations.map(({ key, label, icon: Icon, onPress, ...own }) => {
        const loading = own.loading === true;
        const off = disabled || own.disabled === true || loading;
        const note = own.note ?? null;
        return (
          <Press
            key={key}
            accessibilityRole="button"
            accessibilityLabel={note === null ? label : `${label}, ${note}`}
            accessibilityState={{ disabled: off, busy: loading }}
            disabled={off}
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
              {loading ? (
                <ActivityIndicator size="small" color={tertiary} />
              ) : (
                <Icon size={26} color={off ? tertiary : foreground} strokeWidth={1.5} />
              )}
            </View>
            <View>
              <Text numberOfLines={2} className="text-center font-sans text-caption text-secondary">
                {label}
              </Text>
              {note !== null && (
                <Text
                  numberOfLines={1}
                  className="text-center font-sans text-caption text-secondary"
                >
                  {note}
                </Text>
              )}
            </View>
          </Press>
        );
      })}
    </ScrollView>
  );
}
