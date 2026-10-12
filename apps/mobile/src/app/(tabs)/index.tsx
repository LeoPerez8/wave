import { IconMusic } from "@tabler/icons-react-native";
import { Link, router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { EmptyState } from "@/components/EmptyState";
import { LargeTitleScreen } from "@/components/LargeTitleScreen";
import { AlbumShelf, HomeSection, SongRows } from "@/home/HomeSections";
import type { MostPlayedRow } from "@/library/db/playHistory";
import { useHome } from "@/library/hooks";
import { openStats } from "@/library/routes";

/** Songs played from Home's lists are queued from the section they were in. */
const MOST_PLAYED_CONTEXT = { kind: "home", id: "most-played" } as const;
const FAVORITES_CONTEXT = { kind: "home", id: "favorites" } as const;

const plays = (song: MostPlayedRow): string =>
  `${song.artist} · ${song.playCount} ${song.playCount === 1 ? "play" : "plays"}`;

export default function HomeScreen() {
  const home = useHome();
  const empty = home !== undefined && home.recentlyAdded.length === 0;
  const nothingPlayed =
    home !== undefined && home.recentlyPlayed.length === 0 && home.mostPlayed.length === 0;

  return (
    <LargeTitleScreen title="Home">
      {empty && (
        <EmptyState
          icon={IconMusic}
          title="Nothing here yet"
          message="Your recently added, recently played and most played music will show up here."
        />
      )}
      {home !== undefined && !empty && (
        <>
          <HomeSection title="Recently added" first>
            <AlbumShelf albums={home.recentlyAdded} />
          </HomeSection>
          {nothingPlayed && (
            <Text
              className="font-sans text-subheadline text-secondary"
              style={{ marginTop: CELL * 3 }}
            >
              Play something, and what you listen to will show up here.
            </Text>
          )}
          {home.recentlyPlayed.length > 0 && (
            <HomeSection title="Recently played">
              <AlbumShelf albums={home.recentlyPlayed} />
            </HomeSection>
          )}
          {home.mostPlayed.length > 0 && (
            <HomeSection title="Most played">
              <SongRows songs={home.mostPlayed} context={MOST_PLAYED_CONTEXT} artistLine={plays} />
            </HomeSection>
          )}
          {home.favorites.length > 0 && (
            <HomeSection
              title="Favorites"
              action={{ label: "See all", onPress: () => router.push("/library/favorites") }}
            >
              <SongRows songs={home.favorites} context={FAVORITES_CONTEXT} />
            </HomeSection>
          )}
          <View style={{ marginTop: CELL * 5 }}>
            <Hairline />
            <EntryRow label="Stats" onPress={openStats} />
          </View>
        </>
      )}
      {/* Temporary entry to the glass spike (#4), kept until its numbers confirm the technique. */}
      <Link href="/dev/glass" asChild>
        <Pressable className="mt-12 self-center py-2">
          <Text className="font-sans text-footnote text-tertiary">Developer: glass spike</Text>
        </Pressable>
      </Link>
    </LargeTitleScreen>
  );
}
