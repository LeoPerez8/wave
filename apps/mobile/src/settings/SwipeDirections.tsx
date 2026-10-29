import { currentLocalisation } from "@/localisation/localisation";
import { useLocalisation } from "@/localisation/localisation";
import { IconSwipeLeft, IconSwipeRight, type Icon } from "@tabler/icons-react-native";
import {
  SWIPE_CHOICES,
  swipeChoiceLabelFor,
  type RowSwipeSide,
  type SwipeChoice,
} from "@wave/core";
import { router } from "expo-router";
import { Text, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import { ChoiceRow } from "./ChoiceRow";
import { SettingsPageScreen } from "./SettingsPage";
import { setSwipeChoice, useSwipeSettings } from "./swipeActions";

interface SwipeDirection {
  /** Its row's title, its picker's header and what a screen reader calls it. */
  readonly title: string;
  /** Where its picker is (also `wave://settings/swipe-actions/<side>`). */
  readonly route: "/settings/swipe-actions/left" | "/settings/swipe-actions/right";
  readonly icon: Icon;
}

const DIRECTIONS: Readonly<Record<RowSwipeSide, SwipeDirection>> = {
  left: {
    get title() {
      return currentLocalisation().strings.settings.swipeLeft;
    },
    route: "/settings/swipe-actions/left",
    icon: IconSwipeLeft,
  },
  right: {
    get title() {
      return currentLocalisation().strings.settings.swipeRight;
    },
    route: "/settings/swipe-actions/right",
    icon: IconSwipeRight,
  },
};

/** The two directions, in the order Settings › Swipe actions lists them. */
export const SWIPE_SIDES: readonly RowSwipeSide[] = ["left", "right"];

/**
 * A direction's row on Settings › Swipe actions: its glyph, its name and the
 * action it runs under it; a tap opens its picker. With swipes off it stays,
 * dimmed and inert, so the page still says what each direction would run.
 */
export function SwipeDirectionRow({
  side,
  chosen,
  enabled,
}: {
  side: RowSwipeSide;
  chosen: SwipeChoice;
  enabled: boolean;
}) {
  const { language, strings } = useLocalisation();
  const { title, route, icon: Glyph } = DIRECTIONS[side];
  const foreground = useThemeColor("foreground");
  const tertiary = useThemeColor("tertiary");
  const action = swipeChoiceLabelFor(language)(chosen);
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${action}`}
      accessibilityHint={enabled ? strings.settings.swipeHint(side) : undefined}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={() => router.push(route)}
      haptic="selection"
    >
      {/* At least a row tall; large text grows it rather than clipping either line. */}
      <View
        className="flex-row items-center"
        style={{ minHeight: grid.row, paddingVertical: CELL, gap: CELL * 2 }}
      >
        <Glyph size={24} color={enabled ? foreground : tertiary} strokeWidth={1.5} />
        <View className="flex-1 justify-center">
          <Text
            className={`font-sans text-title3 font-normal ${enabled ? "text-foreground" : "text-secondary"}`}
          >
            {title}
          </Text>
          <Text className="font-sans text-subheadline text-secondary">{action}</Text>
        </View>
      </View>
      <Hairline />
    </Press>
  );
}

/** Back to Swipe actions, there being nothing under a picker opened from a link. */
const closePicker = (): void => {
  if (router.canGoBack()) router.back();
  else router.replace("/settings/swipe-actions");
};

/**
 * A direction's picker: its title, then a row per action (Core's
 * `SWIPE_CHOICES`), the chosen one checked, and under them what a choice does
 * on a song it doesn't fit. A tap saves that direction alone at once and goes
 * back to Swipe actions; Back leaves it as it was.
 */
export function SwipeChoicePickerScreen({ side }: { side: RowSwipeSide }) {
  const { language, strings } = useLocalisation();
  const choiceLabel = swipeChoiceLabelFor(language);
  const { title } = DIRECTIONS[side];
  const chosen = useSwipeSettings()[side];
  return (
    <SettingsPageScreen title={title}>
      <View>
        <Hairline />
        <View accessibilityRole="radiogroup" accessibilityLabel={title}>
          {SWIPE_CHOICES.map((choice) => {
            const label = choiceLabel(choice);
            return (
              <ChoiceRow
                key={choice}
                label={label}
                accessibilityLabel={`${label}, ${title.toLowerCase()}`}
                chosen={choice === chosen}
                onPress={() => {
                  setSwipeChoice(side, choice);
                  closePicker();
                }}
              />
            );
          })}
        </View>
        <Text className="mt-2 font-sans text-footnote text-secondary">
          {strings.settings.removeTakesASongOutOfThe}
        </Text>
      </View>
    </SettingsPageScreen>
  );
}
