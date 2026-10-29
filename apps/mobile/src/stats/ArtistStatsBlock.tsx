import { useLocalisation } from "@/localisation/localisation";
import { useEffect, useMemo } from "react";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TitledSection } from "@/catalog/TitledSection";
import { TotalsLine } from "@/catalog/TotalsLine";
import type { SongRow } from "@/library/LibraryStore";
import { perfMark, useRenderCount } from "@/perf/perf";

import { useArtistStats } from "./hooks";
import { RankedSongs } from "./StatsViews";

/**
 * An artist page's stats over all time, over the songs whose credit names
 * the artist, as in Stats (a collaboration counts for each of its artists):
 * plays, minutes listened, songs listened out of theirs and when they were
 * last played, then their most played songs (tapping one plays that list
 * from it). An artist never played reads so in one line, without the list.
 */
export function ArtistStatsBlock({
  artistId,
  songs,
}: {
  artistId: number;
  /** The artist's songs on the page; the block is read again when they change. */
  songs: readonly SongRow[];
}) {
  const { strings } = useLocalisation();
  useRenderCount("ArtistStatsBlock");
  const stats = useArtistStats(artistId, songs);
  const context = useMemo(() => ({ kind: "stats", id: `artist-${artistId}` }), [artistId]);
  // The page's response in the release runner's push-artist scenario: the block on screen.
  useEffect(() => {
    if (stats === undefined) return;
    const frame = requestAnimationFrame(() =>
      perfMark("artist.stats", stats.played ? "played" : "not played"),
    );
    return () => cancelAnimationFrame(frame);
  }, [stats]);
  if (stats === undefined) return null;
  return (
    <View>
      <TitledSection title={strings.home.sections.stats}>
        {stats.played ? (
          <View style={{ gap: CELL / 2 }}>
            <TotalsLine totals={[stats.plays, stats.minutesListened, stats.songsListened]} />
            <Text className="font-sans text-subheadline text-secondary">{stats.lastPlayed}</Text>
          </View>
        ) : (
          <Text className="font-sans text-subheadline text-secondary">
            {strings.stats.notPlayedYet}
          </Text>
        )}
      </TitledSection>
      {stats.played && stats.mostPlayed.length > 0 && (
        <TitledSection title={strings.stats.mostPlayed}>
          <RankedSongs ranking={stats.mostPlayed} context={context} />
        </TitledSection>
      )}
    </View>
  );
}
