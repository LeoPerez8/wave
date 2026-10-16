import type { TabBarTab } from "@wave/core";
import { useTabTrigger } from "expo-router/ui";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { grid } from "@/catalog/grid";
import { Glass } from "@/glass/Glass";
import { Press } from "@/motion/Press";
import { useRenderCount } from "@/perf/perf";
import { requestSearchFocus } from "@/search/focusRequest";
import { useTabBar } from "@/settings/tabBar";
import { useThemeColor } from "@/theme/useThemeColor";

import { BACKDROP, chrome } from "./chrome";
import { OnFloatingChrome } from "./onFloatingChrome";
import { openTabBarEditor } from "./TabBarEditor";
import { tabLook } from "./tabs";

type TabProps = {
  name: TabBarTab;
  /** Show the label under the icon (the Search pill is icon-only). */
  showLabel?: boolean;
  /** Runs before switching to this tab. */
  onSwitch: (to: TabBarTab) => void;
  /** Runs on every tap, the current tab included. */
  onTap?: () => void;
};

/**
 * One tab inside a pill: teal when it's the current tab, graphite otherwise.
 * A long press opens the tab bar's editor.
 */
function Tab({ name, showLabel = true, onSwitch, onTap }: TabProps) {
  const { triggerProps } = useTabTrigger({ name });
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  const { label, icon: Icon } = tabLook(name);
  const focused = triggerProps.isFocused;
  const color = focused ? accent : secondary;
  return (
    <Press
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityHint="Long press to edit the tab bar"
      accessibilityState={{ selected: focused }}
      onPress={(event) => {
        if (!focused) onSwitch(name);
        onTap?.();
        triggerProps.onPress?.(event);
      }}
      onLongPress={openTabBarEditor}
      haptic="selection"
      depth={0.1}
      className="flex-1 items-center justify-center"
      style={{ gap: 2 }}
    >
      <Icon size={24} color={color} strokeWidth={1.5} />
      {showLabel && (
        <Text numberOfLines={1} className="font-sans text-caption font-semibold" style={{ color }}>
          {label}
        </Text>
      )}
    </Press>
  );
}

const RADIUS = chrome.tabBar / 2;

/**
 * The floating glass tab bar the owner arranges: Home and the tabs after it
 * share one pill, and Search, when it's on, sits beside it in a pill of its
 * own. Tapping Search brings the keyboard up; a long press on any tab opens
 * the bar's editor.
 */
export function TabBar({ onTabTap }: { onTabTap: (to: TabBarTab) => void }) {
  useRenderCount("TabBar");
  const insets = useSafeAreaInsets();
  const bar = useTabBar();
  return (
    <OnFloatingChrome value>
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
          {bar.map((tab) =>
            tab === "search" ? null : <Tab key={tab} name={tab} onSwitch={onTabTap} />,
          )}
        </View>
        {bar.includes("search") && (
          <View className="flex-row" style={{ width: chrome.tabBar }}>
            <Glass backdropId={BACKDROP.tabs} cornerRadius={RADIUS} />
            <Tab name="search" showLabel={false} onSwitch={onTabTap} onTap={requestSearchFocus} />
          </View>
        )}
      </View>
    </OnFloatingChrome>
  );
}
