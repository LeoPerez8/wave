import { Text, View } from "react-native";

import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { SettingsPageScreen } from "@/settings/SettingsPage";
import { setSwipesOn, useSwipeSettings } from "@/settings/swipeActions";
import { SWIPE_SIDES, SwipeDirectionRow } from "@/settings/SwipeDirections";

/**
 * Settings › Swipe actions: whether song rows swipe, then a row per direction
 * saying which long-press action it runs, each opening that direction's
 * picker (`swipe-actions/left`, `swipe-actions/right`). Each change is saved
 * at once and shows on the lists' rows straight away.
 */
export default function SwipeActionsSettingsScreen() {
  const settings = useSwipeSettings();
  const { enabled } = settings;
  return (
    <SettingsPageScreen page="swipeActions">
      <View>
        <Hairline />
        <SettingsSwitch label="Swipe actions" value={enabled} onValueChange={setSwipesOn} />
        <Hairline />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          {enabled
            ? "Swipe a song sideways in a list to run one of its actions. Up Next doesn't swipe."
            : "Song rows don't swipe. Every action is still in a song's long-press menu."}
        </Text>
      </View>
      <View>
        <Hairline />
        {SWIPE_SIDES.map((side) => (
          <SwipeDirectionRow key={side} side={side} chosen={settings[side]} enabled={enabled} />
        ))}
      </View>
    </SettingsPageScreen>
  );
}
