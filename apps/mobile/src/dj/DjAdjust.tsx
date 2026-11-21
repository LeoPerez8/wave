import {
  DJ_DISCOVERIES,
  DJ_FILTERS,
  DJ_MOOD_FILTERS,
  DJ_VARIETIES,
  djDiscoveryLabel,
  djFilterOn,
  djToggleMood,
  djToggleFilter,
  type DjSettings,
  type SliderRange,
} from "@wave/core";
import { ScrollView, Text, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSlider } from "@/components/SettingsSlider";
import { TextButton } from "@/components/TextButton";
import { useLocalisation } from "@/localisation/localisation";

/** Both sliders: three steps, from the left end to the right one. */
const STEPS: SliderRange = { min: 1, max: 3, step: 1 };

/** The choice a three-step slider's [value] stands for, the middle one for anything else. */
const choiceAt = <T,>(choices: readonly T[], value: number): T => choices[value - 1] ?? choices[1]!;

/**
 * DJ's Adjust screen (docs/spec.md, DJ): how the queue Done starts should
 * behave. Artist variety is how far it strays from the selected artists and
 * Music discovery how much of it is new. Under them, the Filters chips:
 * Trending and Lesser-known songs lean it to hits or to deep cuts, one at a
 * time (Core's `djToggleFilter`), and New releases to recent records. The
 * choices are DJ's own: they move no slider of Discover's and change no
 * other queue or mix.
 */
export function DjAdjust({
  settings,
  onChange,
}: {
  settings: DjSettings;
  onChange: (settings: DjSettings) => void;
}) {
  const { strings } = useLocalisation();
  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: CELL * 3 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text
        accessibilityRole="header"
        className="font-sans text-title1 font-light text-foreground"
        style={{ paddingBottom: CELL * 2 }}
      >
        {strings.dj.adjust}
      </Text>
      <Hairline />
      <SettingsSlider
        label={strings.dj.artistVariety}
        value={DJ_VARIETIES.indexOf(settings.variety) + 1}
        range={STEPS}
        format={(value) => strings.dj.varietySteps[choiceAt(DJ_VARIETIES, value)]}
        onChange={(value) => onChange({ ...settings, variety: choiceAt(DJ_VARIETIES, value) })}
      />
      <Text className="pb-3 font-sans text-footnote text-secondary">
        {strings.dj.varietyNotes[settings.variety]}
      </Text>
      <Hairline />
      <View className="pb-3">
        <SettingsSlider
          label={strings.dj.musicDiscovery}
          value={DJ_DISCOVERIES.indexOf(settings.discovery) + 1}
          range={STEPS}
          format={(value) => djDiscoveryLabel(choiceAt(DJ_DISCOVERIES, value), strings)}
          onChange={(value) =>
            onChange({ ...settings, discovery: choiceAt(DJ_DISCOVERIES, value) })
          }
        />
      </View>
      <Hairline />
      <Text
        accessibilityRole="header"
        className="pt-3 font-sans text-title3 font-normal text-foreground"
      >
        {strings.dj.filters}
      </Text>
      <View className="flex-row flex-wrap" style={{ gap: CELL, paddingVertical: CELL * 1.5 }}>
        {DJ_FILTERS.map((filter) => {
          const on = djFilterOn(settings, filter);
          return (
            <TextButton
              key={filter}
              variant="pill"
              tone="secondary"
              label={strings.dj.filterNames[filter]}
              selected={on}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => onChange(djToggleFilter(settings, filter))}
              style={{ paddingHorizontal: CELL * 2 }}
            />
          );
        })}
      </View>
      <Hairline />
      <Text
        accessibilityRole="header"
        className="pt-3 font-sans text-title3 font-normal text-foreground"
      >
        {strings.dj.mood}
      </Text>
      <View className="flex-row flex-wrap" style={{ gap: CELL, paddingVertical: CELL * 1.5 }}>
        {DJ_MOOD_FILTERS.map((mood) => {
          const on = settings.mood === mood;
          return (
            <TextButton
              key={mood}
              variant="pill"
              tone="secondary"
              label={strings.dj.moodNames[mood]}
              selected={on}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => onChange(djToggleMood(settings, mood))}
              style={{ paddingHorizontal: CELL * 2 }}
            />
          );
        })}
      </View>
      <Hairline />
    </ScrollView>
  );
}
