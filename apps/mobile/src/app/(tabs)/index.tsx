import { useLocalisation } from "@/localisation/localisation";
import { useScreenContent } from "@/lib/screenTiming";
import { IconMusic, IconSettings } from "@tabler/icons-react-native";
import { homeItems, type RecapPeriod } from "@wave/core";
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { router } from "@/lib/timingRouter";
import { Pressable, Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { LargeTitleScreen } from "@/components/LargeTitleScreen";
import { useHomeArrangement, homeTitleLongPress } from "@/home/homeArrangement";
import { HomeSection, SECTION_GAP } from "@/home/HomeSection";
import { HomeSectionSkeleton } from "@/home/HomeSectionSkeleton";
import { afterHomeFrame, homeOpeningState } from "@/home/homeOpening";
import { useHomeContent } from "@/library/hooks";
import { useRenderCount } from "@/perf/perf";
import { useRecapToAnnounce } from "@/stats/hooks";
import { RecapCard } from "@/stats/StatsViews";

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

export default function HomeScreen() {
  const { strings } = useLocalisation();
  useRenderCount("HomeScreen");
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
  // Even focus effects in Discover or Recap cannot read before the shell has painted.
  return (
    <LargeTitleScreen
      title={strings.tabs.index}
      titleLongPress={homeTitleLongPress(strings)}
      action={
        <IconButton
          icon={IconSettings}
          label={strings.home.settings}
          onPress={() => router.push("/settings")}
        />
      }
    >
      {painted ? <HomeContent newRecap={newRecap} /> : <HomePlaceholders newRecap={newRecap} />}
    </LargeTitleScreen>
  );
}

function HomePlaceholders({ newRecap }: { newRecap: RecapPeriod | null }) {
  useScreenContent(false);
  const arrangement = useHomeArrangement();
  return (
    <>
      <HomeRecap period={newRecap} />
      <View style={newRecap === null ? FIRST_SECTION : undefined}>
        {arrangement.sections
          // Followed artists' sections draw their own wait, if any.
          .filter((id) => id !== "new-releases" && id !== "upcoming-shows")
          .map((id) => (
            <HomeSectionSkeleton key={id} id={id} />
          ))}
      </View>
    </>
  );
}

function HomeContent({ newRecap }: { newRecap: RecapPeriod | null }) {
  const { strings } = useLocalisation();
  const home = useHomeContent();
  const { empty, nothingPlayed, ready } = homeOpeningState(home);
  useScreenContent(ready);
  const arrangement = useHomeArrangement();

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
              <HomeSection key={item.section} id={item.section} home={home} />
            ),
          )}
        </>
      )}
      {!empty && (
        <>
          <HomeRecap period={newRecap} />
          {/* Sections with nothing to show draw nothing, so whichever shows first is pulled up. */}
          <View style={newRecap === null ? FIRST_SECTION : undefined}>
            {homeItems(arrangement, { nothingPlayed }).map((item, index) =>
              item === "no-sections" ? (
                <HomeLine key={item} top={SECTION_GAP}>
                  {strings.home.noSections}
                </HomeLine>
              ) : item === "play-hint" ? (
                <HomeLine key={item} top={index === 0 ? SECTION_GAP : CELL * 3}>
                  {strings.home.playHint}
                </HomeLine>
              ) : (
                <HomeSection key={item.section} id={item.section} home={home} />
              ),
            )}
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
