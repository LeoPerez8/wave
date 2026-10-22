import { useScreenContent } from "@/lib/screenTiming";
import { SWIPE_CHOICES, swipeChoiceLabel, type RowSwipeSide, type SwipeChoice } from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { ChoiceRow } from "@/settings/ChoiceRow";
import { SettingsPageScreen } from "@/settings/SettingsPage";
import { setSwipeChoice, setSwipesOn, useSwipeSettings } from "@/settings/swipeActions";

/** One direction's picker: its name, then a row per action, the chosen one checked. */
function SwipeChoiceSection({
  side,
  title,
  chosen,
}: {
  side: RowSwipeSide;
  title: string;
  chosen: SwipeChoice;
}) {
  return (
    <View>
      <CatalogLine className="mb-2">{title}</CatalogLine>
      <Hairline />
      <View accessibilityRole="radiogroup" accessibilityLabel={title}>
        {SWIPE_CHOICES.map((choice) => (
          <ChoiceRow
            key={choice}
            label={swipeChoiceLabel(choice)}
            chosen={choice === chosen}
            onPress={() => setSwipeChoice(side, choice)}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Settings › Swipe actions: whether song rows swipe, and which long-press
 * action each direction runs (Core's `SWIPE_CHOICES`). Each change is saved
 * at once and shows on the lists' rows straight away.
 */
export default function SwipeActionsSettingsScreen() {
  useScreenContent(true);
  const { enabled, right, left } = useSwipeSettings();
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
      {enabled && <SwipeChoiceSection side="right" title="Swipe right" chosen={right} />}
      {enabled && (
        <View>
          <SwipeChoiceSection side="left" title="Swipe left" chosen={left} />
          <Text className="mt-2 font-sans text-footnote text-secondary">
            Remove takes a song out of the playlist it's in, and elsewhere asks before deleting it.
            A song without the chosen action, such as Download on a song already on the phone,
            doesn't swipe that way.
          </Text>
        </View>
      )}
    </SettingsPageScreen>
  );
}
