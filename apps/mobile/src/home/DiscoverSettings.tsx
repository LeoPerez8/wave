import { IconAdjustmentsHorizontal } from "@tabler/icons-react-native";
import {
  GENRE_FAITHFULNESS_STEPS,
  POPULARITY_STEPS,
  discoverLevelLabel,
  homeSectionTitle,
  sliderStep,
  sliderStepLabel,
  type SliderRange,
} from "@wave/core";
import { ScrollView, Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { IconButton } from "@/components/IconButton";
import { SettingsSlider } from "@/components/SettingsSlider";
import { pressedRect } from "@/motion/pressedRect";
import { openOverlay } from "@/overlay/overlay";

import {
  discoverSlidersNow,
  setDiscoverLevel,
  setDiscoverSliders,
  useDiscoverLevel,
  useDiscoverSliders,
} from "./discoverMixLevel";

/** Every slider of the card: five steps, from its left end to its right one. */
const STEPS: SliderRange = { min: 1, max: 5, step: 1 };

/** The card's title: Discover's, as Home heads the section. */
const TITLE = homeSectionTitle("discover");

/**
 * Discover's level card: three sliders for the Magic Queue, Artist mixes
 * and Genre mixes alike, applied as they move. New music (each step's name
 * and share, "Balanced · 60% new"), Genre faithfulness (from the seed's own
 * genres to neighbouring ones) and Popularity (from hits to deep cuts).
 * Live: it reads the values as they change, so a screen reader's adjust
 * and a drag both show at once.
 */
function DiscoverCard() {
  const level = useDiscoverLevel();
  const sliders = useDiscoverSliders();
  return (
    <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
      <Text
        accessibilityRole="header"
        className="font-sans text-body font-medium text-foreground"
        style={{ paddingBottom: CELL * 1.5 }}
      >
        {TITLE}
      </Text>
      <Hairline />
      <View className="pb-1">
        <SettingsSlider
          compact
          label="New music"
          value={level}
          range={STEPS}
          format={(value) => discoverLevelLabel(sliderStep(value))}
          onChange={(value) => setDiscoverLevel(sliderStep(value))}
        />
        <SettingsSlider
          compact
          label="Genre faithfulness"
          value={sliders.faithfulness}
          range={STEPS}
          format={(value) => sliderStepLabel(GENRE_FAITHFULNESS_STEPS, value)}
          onChange={(value) =>
            setDiscoverSliders({ ...discoverSlidersNow(), faithfulness: sliderStep(value) })
          }
        />
        <SettingsSlider
          compact
          label="Popularity"
          value={sliders.popularity}
          range={STEPS}
          format={(value) => sliderStepLabel(POPULARITY_STEPS, value)}
          onChange={(value) =>
            setDiscoverSliders({ ...discoverSlidersNow(), popularity: sliderStep(value) })
          }
        />
      </View>
    </ScrollView>
  );
}

/**
 * Discover's header control: the adjustments icon, sized and weighted as
 * Home's gear, opening Discover's card next to itself. Its sliders apply as
 * they move: both mix rows' saved mixes re-blend (New music) or re-rank
 * from the catalog (Genre faithfulness, Popularity) at once, offline; the
 * Magic Queue's next queue starts at the share and ranks from the next
 * batch. With YT Music off it's dimmed and opens nothing, and TalkBack
 * says it needs YT Music.
 */
export function DiscoverSettingsButton({ ytMusic }: { ytMusic: boolean }) {
  return (
    <IconButton
      icon={IconAdjustmentsHorizontal}
      label={ytMusic ? "Discover settings" : "Discover settings, needs YT Music"}
      opensMenu
      disabled={!ytMusic}
      onPress={() => {
        openOverlay({ label: TITLE, anchor: pressedRect(), render: () => <DiscoverCard /> });
      }}
    />
  );
}
