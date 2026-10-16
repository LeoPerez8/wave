import { IconMusic, IconSettings } from "@tabler/icons-react-native";
import { homeItems } from "@wave/core";
import { Link, router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { LargeTitleScreen } from "@/components/LargeTitleScreen";
import { useHomeArrangement, homeTitleLongPress } from "@/home/homeArrangement";
import { HomeSection, SECTION_GAP } from "@/home/HomeSection";
import { useHome } from "@/library/hooks";
import { useRenderCount } from "@/perf/perf";
import { useYtMusicEnabled } from "@/settings/ytMusic";

/** The first section sits a cell under the large title, not a section's gap. */
const FIRST_SECTION = { marginTop: CELL - SECTION_GAP } as const;

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
  const home = useHome();
  const arrangement = useHomeArrangement();
  const ytMusic = useYtMusicEnabled();
  const empty = home !== undefined && home.recentlyAdded.length === 0;
  const nothingPlayed =
    home !== undefined && home.recentlyPlayed.length === 0 && home.mostPlayed.length === 0;

  return (
    <LargeTitleScreen
      title="Home"
      titleLongPress={homeTitleLongPress}
      action={
        <IconButton icon={IconSettings} label="Settings" onPress={() => router.push("/settings")} />
      }
    >
      {empty && (
        <EmptyState
          icon={IconMusic}
          title="Nothing here yet"
          message="Your recently added, recently played and most played music will show up here."
        />
      )}
      {home !== undefined && !empty && (
        <>
          {/* Sections with nothing to show draw nothing, so whichever shows first is pulled up. */}
          <View style={FIRST_SECTION}>
            {homeItems(arrangement, { nothingPlayed, ytMusic }).map((item, index) =>
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
    </LargeTitleScreen>
  );
}
