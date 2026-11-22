import { useRenderCost } from "@/lib/renderCost";
import type { TabBarTab } from "@wave/core";
import { useTabTrigger } from "expo-router/ui";
import { memo, useLayoutEffect, useRef, type RefObject } from "react";
import { Text, View, type GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { grid } from "@/catalog/grid";
import { Glass } from "@/glass/Glass";
import { useLocalisation } from "@/localisation/localisation";
import { Press } from "@/motion/Press";
import { useRenderCount } from "@/perf/perf";
import { requestSearchFocus } from "@/search/focusRequest";
import { useTabBar } from "@/settings/tabBar";
import { useThemeColor } from "@/theme/useThemeColor";

import { BACKDROP, chrome } from "./chrome";
import { OnFloatingChrome } from "./onFloatingChrome";
import { openTabBarEditor } from "./TabBarEditor";
import { tabLook } from "./tabs";
import type { TappedTrigger } from "./tabSwitches";

/** A tab tapped, with its trigger. */
type TabTap = (to: TabBarTab, trigger: TappedTrigger) => void;

type TabProps = {
  name: TabBarTab;
  /** Show the label under the icon (the Search pill is icon-only). */
  showLabel?: boolean;
  /**
   * Gets every tap on this tab; it decides whether to switch, or re-tap the
   * tab on screen (`useTabSwitches`).
   */
  onSwitch: TabTap;
  /** Runs on every tap, the current tab included. */
  onTap?: () => void;
};

/** The trigger a tab taps with, as its latest render had it. */
type TriggerNow = {
  readonly switchTab: TappedTrigger["switchTab"];
  readonly onPress: ((event: GestureResponderEvent) => void) | undefined;
};

/**
 * One tab inside a pill. expo-router's trigger reads the navigation state, so
 * every tab renders on every navigation; it draws again (`TabFace`) only when
 * it gains or loses focus, and taps with its trigger as it is now (#1439).
 */
function Tab({ name, showLabel = true, onSwitch, onTap }: TabProps) {
  const { triggerProps, switchTab } = useTabTrigger({ name });
  const trigger = useRef<TriggerNow>({ switchTab, onPress: triggerProps.onPress });
  useLayoutEffect(() => {
    trigger.current = { switchTab, onPress: triggerProps.onPress };
  });
  return (
    <TabFace
      name={name}
      showLabel={showLabel}
      focused={triggerProps.isFocused}
      onSwitch={onSwitch}
      onTap={onTap}
      trigger={trigger}
    />
  );
}

type TabFaceProps = Required<Pick<TabProps, "showLabel">> &
  Omit<TabProps, "showLabel"> & {
    focused: boolean;
    trigger: RefObject<TriggerNow>;
  };

/**
 * A tab as drawn: teal when it's the current tab, graphite otherwise. A long
 * press opens the tab bar's editor.
 */
const TabFace = memo(function TabFace({
  name,
  showLabel,
  focused,
  onSwitch,
  onTap,
  trigger,
}: TabFaceProps) {
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  const { strings } = useLocalisation();
  const { label, icon: Icon } = tabLook(name, strings);
  const color = focused ? accent : secondary;
  return (
    <Press
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityHint={strings.tabBar.editHint}
      accessibilityState={{ selected: focused }}
      accessibilityActions={[{ name: "editTabBar", label: strings.tabBar.edit }]}
      menuRequestId="layout-tab-bar"
      onMenuRequest={openTabBarEditor}
      onAccessibilityAction={({ nativeEvent: { actionName } }) => {
        if (actionName === "editTabBar") openTabBarEditor();
      }}
      onPress={(event) => {
        onTap?.();
        const now = trigger.current;
        onSwitch(name, { switchTab: now.switchTab, press: () => now.onPress?.(event) });
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
});

const RADIUS = chrome.tabBar / 2;

/**
 * The floating glass tab bar the owner arranges: Home and the tabs after it
 * share one pill, and Search, when it's on, sits beside it in a pill of its
 * own. Tapping Search brings the keyboard up; a long press on any tab opens
 * the bar's editor. Memoized: the tabs layout renders on navigation, and the
 * bar needn't (its tabs follow the focused one themselves; pass a stable `onTabTap`).
 * Every tap goes to `onTabTap`, which switches or re-taps (`useTabSwitches`).
 */
export const TabBar = memo(function TabBar({ onTabTap }: { onTabTap: TabTap }) {
  useRenderCount("TabBar");
  useRenderCost("TabBar");
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
});
