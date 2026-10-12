import { useMemo } from "react";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { HomeSection } from "@/home/HomeSections";
import { TotalsLine } from "@/home/ListeningOverview";
import type { SongRow } from "@/library/LibraryStore";

import { useArtistStats } from "./hooks";
import { RankedSongs } from "./StatsViews";

/**
 * An artist page's stats over all time, credited by track artist as in
 * Stats: plays, minutes listened, songs listened out of theirs and when they
 * were last played, then their most played songs (tapping one plays that list
 * from it). An artist never played reads so in one line, without the list.
 */
export function ArtistStatsBlock({
  artistId,
  songs,
}: {
  artistId: number;
  /** The artist's songs on the page. */
  songs: readonly SongRow[];
}) {
  const songIds = useMemo(() => songs.map((song) => song.id), [songs]);
  const stats = useArtistStats(artistId, songIds);
  const context = useMemo(() => ({ kind: "stats", id: `artist-${artistId}` }), [artistId]);
  if (stats === undefined) return null;
  return (
    <View>
      <HomeSection title="Stats">
        {stats.played ? (
          <View style={{ gap: CELL / 2 }}>
            <TotalsLine totals={[stats.plays, stats.minutesListened, stats.songsListened]} />
            <Text className="font-sans text-subheadline text-secondary">{stats.lastPlayed}</Text>
          </View>
        ) : (
          <Text className="font-sans text-subheadline text-secondary">Not played yet</Text>
        )}
      </HomeSection>
      {stats.played && stats.mostPlayed.length > 0 && (
        <HomeSection title="Most played">
          <RankedSongs ranking={stats.mostPlayed} context={context} />
        </HomeSection>
      )}
    </View>
  );
}
