import { IconMusic, IconSettings } from "@tabler/icons-react-native";
import { Link, router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TitledSection } from "@/catalog/TitledSection";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { LargeTitleScreen } from "@/components/LargeTitleScreen";
import { AlbumShelf, ArtistShelf, SongRows } from "@/home/HomeSections";
import { ListeningOverview } from "@/home/ListeningOverview";
import type { MostPlayedRow } from "@/library/db/playHistory";
import { useHome } from "@/library/hooks";
import { openStats, openStatsSeeAll } from "@/library/routes";
import { useTopAlbums, useTopArtists } from "@/stats/hooks";
import type { Ranked } from "@/stats/Stats";
import { playCount } from "@/stats/StatsViews";

/** Songs played from Home's lists are queued from the section they were in. */
const MOST_PLAYED_CONTEXT = { kind: "home", id: "most-played" } as const;
const FAVORITES_CONTEXT = { kind: "home", id: "favorites" } as const;

/** How many artists Most played artists shows; the album shelf shows a Stats top. */
const MOST_PLAYED_ARTISTS = 5;

const countedPlays = (entry: { readonly countedPlays: number }): string =>
  playCount(entry.countedPlays);

/** A ranking's entries with their counted plays, as the rows Home's sections take. */
const withPlays = <A,>(ranking: readonly Ranked<A>[] | undefined) =>
  (ranking ?? []).map((entry) => ({ ...entry.item, countedPlays: entry.countedPlays }));

/** The counted plays Most Played is ranked by, shown in each row's trailing cell. */
const plays = (song: MostPlayedRow): number => song.playCount;

export default function HomeScreen() {
  const home = useHome();
  // Stats' all-time rankings, so the order matches Library › Stats.
  const mostPlayedAlbums = withPlays(useTopAlbums("all"));
  const mostPlayedArtists = withPlays(useTopArtists("all", MOST_PLAYED_ARTISTS));
  const empty = home !== undefined && home.recentlyAdded.length === 0;
  const nothingPlayed =
    home !== undefined && home.recentlyPlayed.length === 0 && home.mostPlayed.length === 0;

  return (
    <LargeTitleScreen
      title="Home"
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
          <TitledSection title="Recently added" first>
            <AlbumShelf albums={home.recentlyAdded} />
          </TitledSection>
          {nothingPlayed && (
            <Text
              className="font-sans text-subheadline text-secondary"
              style={{ marginTop: CELL * 3 }}
            >
              Play something, and what you listen to will show up here.
            </Text>
          )}
          {home.recentlyPlayed.length > 0 && (
            <TitledSection title="Recently played">
              <AlbumShelf albums={home.recentlyPlayed} />
            </TitledSection>
          )}
          {home.mostPlayed.length > 0 && (
            <TitledSection title="Most played">
              <SongRows songs={home.mostPlayed} context={MOST_PLAYED_CONTEXT} plays={plays} />
            </TitledSection>
          )}
          {mostPlayedAlbums.length > 0 && (
            <TitledSection
              title="Most played albums"
              action={{ label: "See all", onPress: () => openStatsSeeAll("albums", "all") }}
            >
              <AlbumShelf albums={mostPlayedAlbums} detail={countedPlays} />
            </TitledSection>
          )}
          {mostPlayedArtists.length > 0 && (
            <TitledSection
              title="Most played artists"
              action={{ label: "See all", onPress: () => openStatsSeeAll("artists", "all") }}
            >
              <ArtistShelf artists={mostPlayedArtists} detail={countedPlays} />
            </TitledSection>
          )}
          {home.favorites.length > 0 && (
            <TitledSection
              title="Favorites"
              action={{ label: "See all", onPress: () => router.push("/library/favorites") }}
            >
              <SongRows songs={home.favorites} context={FAVORITES_CONTEXT} />
            </TitledSection>
          )}
          <View style={{ marginTop: CELL * 5 }}>
            <Hairline />
            <EntryRow label="Stats" onPress={openStats} />
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
          {/* Keep the overview last, below every other section. */}
          <ListeningOverview />
        </>
      )}
    </LargeTitleScreen>
  );
}
