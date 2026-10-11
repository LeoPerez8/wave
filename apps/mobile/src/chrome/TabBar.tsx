import { IconHome, IconSearch, IconStack2 } from "@tabler/icons-react-native";
import { useTabTrigger } from "expo-router/ui";
import type { ComponentType } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { grid } from "@/catalog/grid";
import { Glass } from "@/glass/Glass";
import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import { BACKDROP, chrome } from "./chrome";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

type TabProps = {
  name: string;
  label: string;
  icon: ComponentType<IconProps>;
  /** Show the label under the icon (the Search pill is icon-only). */
  showLabel?: boolean;
};

/** One tab inside a pill: teal when it's the current tab, graphite otherwise. */
function Tab({ name, label, icon: Icon, showLabel = true }: TabProps) {
  const { triggerProps } = useTabTrigger({ name });
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  const focused = triggerProps.isFocused;
  const color = focused ? accent : secondary;
  return (
    <Press
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
      onPress={triggerProps.onPress}
      onLongPress={triggerProps.onLongPress}
      haptic="selection"
      depth={0.1}
      className="flex-1 items-center justify-center"
      style={{ gap: 2 }}
    >
      <Icon size={24} color={color} strokeWidth={1.5} />
      {showLabel && (
        <Text className="font-sans text-caption font-semibold" style={{ color }}>
          {label}
        </Text>
      )}
    </Press>
  );
}

const RADIUS = chrome.tabBar / 2;

/**
 * The floating glass tab bar: Home and Library share one pill, and Search
 * sits beside it in a pill of its own.
 */
export function TabBar() {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      pointerEvents="box-none"
      className="absolute left-0 right-0 flex-row"
      style={{
        bottom: insets.bottom + chrome.gap,
        height: chrome.tabBar,
        gap: chrome.gap,
        paddingHorizontal: grid.margin,
      }}
    >
      <View className="flex-1 flex-row">
        <Glass backdropId={BACKDROP.tabs} cornerRadius={RADIUS} />
        <Tab name="index" label="Home" icon={IconHome} />
        <Tab name="library" label="Library" icon={IconStack2} />
      </View>
      <View className="flex-row" style={{ width: chrome.tabBar }}>
        <Glass backdropId={BACKDROP.tabs} cornerRadius={RADIUS} />
        <Tab name="search" label="Search" icon={IconSearch} showLabel={false} />
      </View>
    </View>
  );
}
