import { useLocalisation } from "@/localisation/localisation";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react-native";
import { discoverLevelLabel, sliderStep, type SliderRange } from "@wave/core";
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

/**
 * Discover's level card: three sliders for the Magic Queue, Artist mixes
 * and Genre mixes alike, applied as they move. New music (each step's name
 * and share, "Balanced · 60% new"), Genre faithfulness (the penalty for known
 * unrelated genres) and Popularity (from hits to deep cuts).
 * Live: it reads the values as they change, so a screen reader's adjust
 * and a drag both show at once.
 */
function DiscoverCard() {
  const { strings } = useLocalisation();
  const level = useDiscoverLevel();
  const sliders = useDiscoverSliders();
  return (
    <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
      <Text
        accessibilityRole="header"
        className="font-sans text-body font-medium text-foreground"
        style={{ paddingBottom: CELL * 1.5 }}
      >
        {strings.home.sections.discover}
      </Text>
      <Hairline />
      <View className="pb-1">
        <SettingsSlider
          compact
          label={strings.discover.newMusic}
          value={level}
          range={STEPS}
          format={(value) => discoverLevelLabel(sliderStep(value), strings)}
          onChange={(value) => setDiscoverLevel(sliderStep(value))}
        />
        <SettingsSlider
          compact
          label={strings.discover.genreFaithfulness}
          value={sliders.faithfulness}
          range={STEPS}
          format={(value) => strings.discover.faithfulnessSteps[sliderStep(value)]}
          onChange={(value) =>
            setDiscoverSliders({ ...discoverSlidersNow(), faithfulness: sliderStep(value) })
          }
        />
        <Text className="px-3 pb-2 font-sans text-footnote text-secondary">
          {strings.discover.faithfulnessNote}
        </Text>
        <SettingsSlider
          compact
          label={strings.discover.popularity}
          value={sliders.popularity}
          range={STEPS}
          format={(value) => strings.discover.popularitySteps[sliderStep(value)]}
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
  const { strings } = useLocalisation();
  return (
    <IconButton
      icon={IconAdjustmentsHorizontal}
      label={ytMusic ? strings.discover.settings : strings.discover.settingsNeedsYtMusic}
      opensMenu
      disabled={!ytMusic}
      onPress={() => {
        openOverlay({
          label: strings.home.sections.discover,
          anchor: pressedRect(),
          render: () => <DiscoverCard />,
        });
      }}
    />
  );
}
