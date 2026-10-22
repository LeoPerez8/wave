import { useScreenContent } from "@/lib/screenTiming";
import { IconMusic, IconSettings } from "@tabler/icons-react-native";
import { homeItems } from "@wave/core";
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
import { HomeRecapSkeleton } from "@/home/HomeRecapSkeleton";
import { afterHomeFrame, homeOpeningState } from "@/home/homeOpening";
import { useHomeContent } from "@/library/hooks";
import { useRenderCount } from "@/perf/perf";
import { useRecapToAnnounce } from "@/stats/hooks";
import { RecapCard } from "@/stats/StatsViews";

/** The first section sits a cell under the large title, not a section's gap. */
const FIRST_SECTION = { marginTop: CELL - SECTION_GAP } as const;

/** A new Recap's card sits a cell under the large title, a section's gap above the sections. */
const RECAP_CARD = { marginTop: CELL } as const;

/** A quiet line in Home's flow (no sections, nothing played yet). */
function HomeLine({ children, top }: { children: string; top: number }) {
  return (
    <Text className="font-sans text-subheadline text-secondary" style={{ marginTop: top }}>
      {children}
    </Text>
  );
}

export default function HomeScreen() {
  useRenderCount("HomeScreen");
  const [painted, setPainted] = useState(false);
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
      title="Home"
      titleLongPress={homeTitleLongPress}
      action={
        <IconButton icon={IconSettings} label="Settings" onPress={() => router.push("/settings")} />
      }
    >
      {painted ? <HomeContent /> : <HomePlaceholders />}
    </LargeTitleScreen>
  );
}

function HomePlaceholders() {
  useScreenContent(false);
  const arrangement = useHomeArrangement();
  return (
    <>
      <View style={RECAP_CARD}>
        <HomeRecapSkeleton />
      </View>
      <View>
        {arrangement.map((id) => (
          <HomeSectionSkeleton key={id} id={id} />
        ))}
      </View>
    </>
  );
}

function HomeContent() {
  const home = useHomeContent();
  const { empty, nothingPlayed, settled } = homeOpeningState(home);
  useScreenContent(settled);
  const arrangement = useHomeArrangement();
  const newRecap = useRecapToAnnounce();

  return (
    <>
      {empty && (
        <EmptyState
          icon={IconMusic}
          title="Nothing here yet"
          message="Your recently added, recently played and most played music will show up here."
        />
      )}
      {!empty && (
        <>
          {newRecap !== null && (
            <View style={RECAP_CARD}>
              {newRecap === undefined ? <HomeRecapSkeleton /> : <RecapCard period={newRecap} />}
            </View>
          )}
          {/* Sections with nothing to show draw nothing, so whichever shows first is pulled up. */}
          <View style={newRecap === null ? FIRST_SECTION : undefined}>
            {homeItems(arrangement, { nothingPlayed }).map((item, index) =>
              item === "no-sections" ? (
                <HomeLine key={item} top={SECTION_GAP}>
                  Long-press Home to add sections back.
                </HomeLine>
              ) : item === "play-hint" ? (
                <HomeLine key={item} top={index === 0 ? SECTION_GAP : CELL * 3}>
                  Play something, and what you listen to will show up here.
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
                <Text className="font-sans text-footnote text-tertiary">
                  Developer: glass spike
                </Text>
              </Pressable>
            </Link>
          )}
        </>
      )}
    </>
  );
}
