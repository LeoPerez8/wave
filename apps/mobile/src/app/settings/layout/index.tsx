import { useScreenContent } from "@/lib/screenTiming";
import { useLocalisation } from "@/localisation/localisation";
import { LAYOUT_PAGES } from "@wave/core";
import { router } from "@/lib/timingRouter";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { setKeepFindVisible, useKeepFindVisible } from "@/settings/keepFindVisible";
import { SettingsPageRow, SettingsPageScreen } from "@/settings/SettingsPage";
import { openNowPlayingForLayout } from "@/nowPlaying/sheet";
import { armAnchoredMenu } from "@/motion/menuRequest";
import { shuffleKindChoice } from "@/nowPlaying/ShuffleMenu";
import { ChoiceSection } from "@/settings/ChoiceRow";
import { useShuffleKind } from "@/settings/shuffleKind";

const layoutDestinations = {
  home: () => {
    armAnchoredMenu("layout-home");
    router.push("/");
  },
  library: () => {
    armAnchoredMenu("layout-library");
    router.push("/library");
  },
  playlists: () => {
    armAnchoredMenu("layout-playlists");
    router.push("/playlists");
  },
  tabBar: () => {
    armAnchoredMenu("layout-tab-bar");
    router.push("/");
  },
  nowPlaying: openNowPlayingForLayout,
} as const;

/**
 * Settings › Layout: under the head Customize, the options a long press
 * opens on Home's, the Library's and Playlists' titles and on the tab bar,
 * and Now Playing's buttons, a row each (Core's `LAYOUT_PAGES`), for whoever
 * doesn't know the long press; then the shuffle kind (its section draws its
 * own head and rule); then Keep Find Field Visible.
 */
export default function LayoutSettingsScreen() {
  const { strings } = useLocalisation();
  useScreenContent(true);
  const keepFindVisible = useKeepFindVisible();
  const shuffleKind = useShuffleKind();
  return (
    <SettingsPageScreen page="layout">
      <View>
        <CatalogLine className="mb-2">{strings.settings.layoutPagesHead}</CatalogLine>
        <Hairline />
        {LAYOUT_PAGES.map(({ page }) => (
          <SettingsPageRow
            key={page}
            title={strings.settings.layoutPages[page]}
            summary={null}
            onPress={layoutDestinations[page]}
          />
        ))}
      </View>
      <ChoiceSection
        choice={shuffleKindChoice}
        current={shuffleKind}
        note={strings.settings.everyShuffleUsesItALongPress}
      />
      <View>
        <Hairline />
        <SettingsSwitch
          label={strings.settings.keepFindFieldVisible}
          value={keepFindVisible}
          onValueChange={setKeepFindVisible}
        />
        <Hairline />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          {strings.settings.theFindFieldStaysUnderThePages}
        </Text>
      </View>
    </SettingsPageScreen>
  );
}
