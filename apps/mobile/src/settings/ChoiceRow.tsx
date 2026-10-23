import { IconCheck } from "@tabler/icons-react-native";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import type { PersistedSetting } from "@/lib/persistedSetting";
import { Press } from "@/motion/Press";
import type { TitleChoice } from "@/overlay/titleChoices";
import { useThemeColor } from "@/theme/useThemeColor";

/**
 * One choice of a Settings radio list; the current one carries a check.
 * [accessibilityLabel] names it for a screen reader where the label alone
 * doesn't say what it's chosen for (a swipe direction's action).
 */
export function ChoiceRow({
  label,
  chosen,
  onPress,
  accessibilityLabel = label,
}: {
  label: string;
  chosen: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const accent = useThemeColor("accent");
  return (
    <Press
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: chosen }}
      onPress={onPress}
      haptic="selection"
    >
      {/* At least a row tall; large text grows it rather than clipping the label. */}
      <View
        className="flex-row items-center"
        style={{ minHeight: grid.row, paddingVertical: CELL / 2 }}
      >
        <Text className="flex-1 font-sans text-title3 font-normal text-foreground">{label}</Text>
        {chosen && <IconCheck size={24} color={accent} strokeWidth={1.5} />}
      </View>
      <Hairline />
    </Press>
  );
}

/**
 * A setting picked from a short list, offered both by a title's long press
 * (`openTitleChoices`) and on a Settings page (`ChoiceSection`), so the two
 * can't drift: what it's called, its choices in order, and where it's kept.
 */
export interface ChoiceSetting<T> {
  readonly label: string;
  readonly choices: readonly TitleChoice<T>[];
  readonly setting: PersistedSetting<T>;
}

/**
 * A Settings page's section for [choice]: its name, then a row per choice,
 * [current] checked (the setting's `useValue`), and [note] under them when
 * given. A tap saves it at once, so the screen it shapes shows it straight
 * away.
 */
export function ChoiceSection<T>({
  choice,
  current,
  note,
}: {
  choice: ChoiceSetting<T>;
  current: T;
  note?: string;
}) {
  return (
    <View>
      <CatalogLine className="mb-2">{choice.label}</CatalogLine>
      <Hairline />
      <View accessibilityRole="radiogroup" accessibilityLabel={choice.label}>
        {choice.choices.map(({ value, label }) => (
          <ChoiceRow
            key={label}
            label={label}
            chosen={Object.is(value, current)}
            onPress={() => choice.setting.set(value)}
          />
        ))}
      </View>
      {note !== undefined && (
        <Text className="mt-2 font-sans text-footnote text-secondary">{note}</Text>
      )}
    </View>
  );
}
