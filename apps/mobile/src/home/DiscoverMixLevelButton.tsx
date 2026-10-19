import {
  GENRE_FAITHFULNESS_STEPS,
  POPULARITY_STEPS,
  homeSectionTitle,
  sliderStep,
  sliderStepLabel,
  type SliderRange,
} from "@wave/core";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSlider } from "@/components/SettingsSlider";
import { TextButton } from "@/components/TextButton";
import { pressedRect } from "@/motion/pressedRect";
import { openOverlay } from "@/overlay/overlay";

import {
  mixSlidersOf,
  sectionLevelShare,
  setMixSliders,
  setSectionLevel,
  useMixSliders,
  useSectionLevel,
  type LevelSectionId,
} from "./discoverMixLevel";

/** Every slider of the card: five steps, from its left end to its right one. */
const STEPS: SliderRange = { min: 1, max: 5, step: 1 };

/**
 * The level card: the section's three sliders, applied as they move. New
 * music (its share, "60% new"), Genre faithfulness (from the seed's own
 * genres to neighbouring ones) and Popularity (from hits to deep cuts).
 * Live: it reads the values as they change, so a screen reader's adjust
 * and a drag both show at once.
 */
function LevelCard({ section }: { section: LevelSectionId }) {
  const level = useSectionLevel(section);
  const sliders = useMixSliders(section);
  return (
    <>
      <Text
        accessibilityRole="header"
        className="font-sans text-body font-medium text-foreground"
        style={{ paddingBottom: CELL * 1.5 }}
      >
        {homeSectionTitle(section)}
      </Text>
      <Hairline />
      <View className="pb-1">
        <SettingsSlider
          compact
          label="New music"
          value={level}
          range={STEPS}
          format={(value) => sectionLevelShare(section, sliderStep(value))}
          onChange={(value) => setSectionLevel(section, sliderStep(value))}
        />
        <SettingsSlider
          compact
          label="Genre faithfulness"
          value={sliders.faithfulness}
          range={STEPS}
          format={(value) => sliderStepLabel(GENRE_FAITHFULNESS_STEPS, value)}
          onChange={(value) =>
            setMixSliders(section, { ...mixSlidersOf(section), faithfulness: sliderStep(value) })
          }
        />
        <SettingsSlider
          compact
          label="Popularity"
          value={sliders.popularity}
          range={STEPS}
          format={(value) => sliderStepLabel(POPULARITY_STEPS, value)}
          onChange={(value) =>
            setMixSliders(section, { ...mixSlidersOf(section), popularity: sliderStep(value) })
          }
        />
      </View>
    </>
  );
}

/**
 * A section's header control (Artist mixes, Genre mixes, Magic Queue): how
 * much of what it plays is new ("60% new"), opening the section's level
 * card next to itself. Its sliders apply as they move: a mix section's saved
 * mixes re-blend (New music) or re-rank from the catalog (Genre
 * faithfulness, Popularity) at once, offline; the Magic Queue's set the
 * share the next Magic Queue starts at and rank from the next batch. With a
 * [disabledNote] it's disabled: dimmed, opening nothing, the note in place
 * of the share (the Magic Queue's "Needs YT Music" while YT Music is off).
 */
export function DiscoverMixLevelButton({
  section,
  disabledNote,
}: {
  section: LevelSectionId;
  disabledNote?: string;
}) {
  const level = useSectionLevel(section);
  const open = () => {
    openOverlay({
      label: homeSectionTitle(section),
      anchor: pressedRect(),
      render: () => <LevelCard section={section} />,
    });
  };
  return (
    <TextButton
      label={disabledNote ?? sectionLevelShare(section, level)}
      opensMenu
      disabled={disabledNote !== undefined}
      onPress={open}
    />
  );
}
