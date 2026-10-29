import { useLocalisation } from "@/localisation/localisation";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react-native";
import {
  discoverLevelLabel,
  sliderStep,
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


/**
 * Discover's level card: three sliders for the Magic Queue, Artist mixes
 * and Genre mixes alike, applied as they move. New music (each step's name
 * and share, "Balanced · 60% new"), Genre faithfulness (the penalty for known
 * unrelated genres) and Popularity (from hits to deep cuts).
 * Live: it reads the values as they change, so a screen reader's adjust
 * and a drag both show at once.
 */
function DiscoverCard() {
 const localisation = useLocalisation();

  const level = useDiscoverLevel();
  const sliders = useDiscoverSliders();
  return (
    <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
      <Text
        accessibilityRole="header"
        className="font-sans text-body font-medium text-foreground"
        style={{ paddingBottom: CELL * 1.5 }}
      >
        {localisation.strings.home.discover}
      </Text>
      <Hairline />
      <View className="pb-1">
        <SettingsSlider
          compact
          label={localisation.strings.home.newMusic}
          value={level}
          range={STEPS}
          format={(value) => discoverLevelLabel(sliderStep(value), localisation.strings)}
          onChange={(value) => setDiscoverLevel(sliderStep(value))}
        />
        <SettingsSlider
          compact
          label={localisation.strings.home.genreFaithfulness}
          value={sliders.faithfulness}
          range={STEPS}
          format={(value) => [localisation.strings.home.sameGenres, localisation.strings.home.closeGenres, localisation.strings.home.balanced, localisation.strings.home.neighbours, localisation.strings.home.wander][sliderStep(value) - 1]!}
          onChange={(value) =>
            setDiscoverSliders({ ...discoverSlidersNow(), faithfulness: sliderStep(value) })
          }
        />
        <Text className="px-3 pb-2 font-sans text-footnote text-secondary">
          {localisation.strings.home.sameGenresExcludesKnownUnrelatedGenresCloseBalancedAndNeighboursLowerThemLessAtEachStepWanderIgnoresGenreUnknownGenresAlwaysStay}</Text>
        <SettingsSlider
          compact
          label={localisation.strings.home.popularity}
          value={sliders.popularity}
          range={STEPS}
          format={(value) => [localisation.strings.home.hits, localisation.strings.home.popular, localisation.strings.home.balanced, localisation.strings.home.lesserKnown, localisation.strings.home.deepCuts][sliderStep(value) - 1]!}
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
 const localisation = useLocalisation();

  return (
    <IconButton
      icon={IconAdjustmentsHorizontal}
      label={ytMusic ? localisation.strings.home.discoverSettings : localisation.strings.home.discoverSettingsNeedsYtMusic}
      opensMenu
      disabled={!ytMusic}
      onPress={() => {
        openOverlay({ label: localisation.strings.home.discover, anchor: pressedRect(), render: () => <DiscoverCard /> });
      }}
    />
  );
}
