import { useRenderCost } from "@/lib/renderCost";
import { HomeFollowProvider } from "@/home/useHomeFollow";
import { useLocalisation } from "@/localisation/localisation";
import { useScreenContent } from "@/lib/screenTiming";
import { IconMusic, IconSettings } from "@tabler/icons-react-native";
import { homeItems, type RecapPeriod } from "@wave/core";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { router } from "@/lib/timingRouter";
import { Pressable, Text, View, useWindowDimensions } from "react-native";

import { CELL } from "@/catalog/grid";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { LargeTitleScreen } from "@/components/LargeTitleScreen";
import { StagedSections } from "@/components/StagedSections";
import { useHomeArrangement, homeTitleLongPress } from "@/home/homeArrangement";
import { HomeSection, SECTION_GAP } from "@/home/HomeSection";
import { useHomeScreenContent } from "@/home/homeContent";
import { afterHomeFrame, homeItemEstimate, homeOpeningState } from "@/home/homeOpening";
import { startSavingHomeSnapshot } from "@/home/homeSnapshot";
import { useHomeWorkSight } from "@/home/useHomeWorkSight";
import { useHomeSelection } from "@/selection/useHomeSelection";
import { useRenderCount } from "@/perf/perf";
import { useRecapToAnnounce } from "@/stats/hooks";
import { RecapCard } from "@/stats/StatsViews";
import { openArmedAnchoredMenu } from "@/motion/menuRequest";

/** The first section sits a cell under the large title, not a section's gap. */
const FIRST_SECTION = { marginTop: CELL - SECTION_GAP } as const;

/** A new Recap's card sits a cell under the large title, a section's gap above the sections. */
const RECAP_CARD = { marginTop: CELL } as const;

/** The debug-only link to the glass spike: a dev screen's, so it stays in English. */
const DEV_GLASS_LABEL = "Developer: glass spike";

function HomeRecap({ period }: { period: RecapPeriod | null }) {
  return period === null ? null : (
    <View style={RECAP_CARD}>
      <RecapCard period={period} />
    </View>
  );
}

/** A quiet line in Home's flow (no sections, nothing played yet). */
function HomeLine({ children, top }: { children: string; top: number }) {
  return (
    <Text className="font-sans text-subheadline text-secondary" style={{ marginTop: top }}>
      {children}
    </Text>
  );
}

/** From Home's first render on, the app leaving saves what Home shows for the next cold start. */
startSavingHomeSnapshot();

export default function HomeScreen() {
  const { strings } = useLocalisation();
  useFocusEffect(
    useCallback(() => {
      openArmedAnchoredMenu("layout-home");
      openArmedAnchoredMenu("layout-tab-bar");
    }, []),
  );
  useRenderCount("HomeScreen");
  useRenderCost("HomeScreen");
  // Home's mixes and sections build only while Home is in sight (#1351).
  useHomeWorkSight();
  const [painted, setPainted] = useState(false);
  const newRecap = useRecapToAnnounce(painted);
  useEffect(
    () =>
      afterHomeFrame(() => setPainted(true), {
        request: requestAnimationFrame,
        cancel: cancelAnimationFrame,
      }),
    [],
  );
  // The first frame draws Home's sections from memory or the cold-start snapshot (#1353);
  // the follow cards' and Recap's reads wait until it has painted.
  return (
    <HomeFollowProvider reading={painted}>
      <LargeTitleScreen
        title={strings.home.title}
        waves
        titleLongPress={homeTitleLongPress(strings)}
        action={
          <IconButton
            icon={IconSettings}
            label={strings.home.settings}
            onPress={() => router.push("/settings")}
          />
        }
      >
        <HomeContent newRecap={newRecap} />
      </LargeTitleScreen>
    </HomeFollowProvider>
  );
}

function HomeContent({ newRecap }: { newRecap: RecapPeriod | null }) {
  const { strings } = useLocalisation();
  useRenderCost("HomeContent");
  const home = useHomeScreenContent();
  const selection = useHomeSelection();
  const endSelection = selection.end;
  useFocusEffect(useCallback(() => () => endSelection(), [endSelection]));
  const { empty, nothingPlayed, ready } = homeOpeningState(home);
  useScreenContent(ready);
  const arrangement = useHomeArrangement();
  const { fontScale, width } = useWindowDimensions();
  // The first frame mounts the sections that start on screen; the rest follow a screen a
  // frame, before a scroll can reach them (#1380).
  const shown = homeItems(arrangement, { nothingPlayed });

  return (
    <>
      {empty && (
        <>
          <EmptyState
            icon={IconMusic}
            title={strings.home.emptyTitle}
            message={strings.home.emptyMessage}
          />
          {/* Discover's Artist mixes grow from YouTube Music's chart while the Library is empty. */}
          {homeItems(arrangement, { nothingPlayed, empty }).map((item) =>
            typeof item === "string" ? null : (
              <HomeSection key={item.section} id={item.section} home={home} selection={selection} />
            ),
          )}
        </>
      )}
      {!empty && (
        <>
          <HomeRecap period={newRecap} />
          {/* Sections with nothing to show draw nothing, so whichever shows first is pulled up. */}
          <View style={newRecap === null ? FIRST_SECTION : undefined}>
            <StagedSections estimate={(index) => homeItemEstimate(shown[index]!, fontScale, width)}>
              {shown.map((item, index) =>
                item === "no-sections" ? (
                  <HomeLine key={item} top={SECTION_GAP}>
                    {strings.home.noSections}
                  </HomeLine>
                ) : item === "play-hint" ? (
                  <HomeLine key={item} top={index === 0 ? SECTION_GAP : CELL * 3}>
                    {strings.home.playHint}
                  </HomeLine>
                ) : (
                  <HomeSection
                    key={item.section}
                    id={item.section}
                    home={home}
                    selection={selection}
                  />
                ),
              )}
            </StagedSections>
          </View>
          {/* Temporary entry to the glass spike (#4), kept until its numbers confirm the technique. */}
          {__DEV__ && (
            <Link href="/dev/glass" asChild>
              <Pressable className="mt-12 self-center py-2">
                <Text className="font-sans text-footnote text-tertiary">{DEV_GLASS_LABEL}</Text>
              </Pressable>
            </Link>
          )}
        </>
      )}
    </>
  );
}
