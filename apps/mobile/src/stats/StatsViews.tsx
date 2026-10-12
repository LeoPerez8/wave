import { STATS_PERIODS, type StatsPeriod } from "@wave/core";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { NameRow } from "@/catalog/NameRow";
import { TrackRow } from "@/catalog/TrackRow";
import { useFavoriteIds } from "@/library/favorites";
import type { AlbumRow, ArtistRow, SongRow } from "@/library/LibraryStore";
import { openAlbum, openArtist } from "@/library/routes";
import { toTrackSummary } from "@/library/TrackList";
import { Press } from "@/motion/Press";
import { playSongs } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";
import {
  openAlbumActions,
  openArtistActions,
  openTrackActions,
} from "@/playback/TrackActionsSheet";
import { ArtworkRow } from "@/search/ArtworkRow";

import type { Ranked } from "./Stats";

/** "3 plays", "1 play". */
export const playCount = (count: number): string =>
  `${count.toLocaleString("en")} ${count === 1 ? "play" : "plays"}`;

/** The period selector: text tabs, the selected one in ink with a teal underline. */
export function PeriodTabs({
  period,
  onChange,
}: {
  period: StatsPeriod;
  onChange: (period: StatsPeriod) => void;
}) {
  return (
    // Wraps rather than clips at large font scales.
    <View
      accessibilityRole="tablist"
      className="flex-row flex-wrap"
      style={{ columnGap: CELL * 3 }}
    >
      {STATS_PERIODS.map((option) => {
        const selected = option.id === period;
        return (
          <Press
            key={option.id}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            haptic="selection"
            style={{ minHeight: 48, justifyContent: "center" }}
          >
            <Text
              numberOfLines={1}
              className={`font-sans text-body ${
                selected ? "font-semibold text-foreground" : "text-secondary"
              }`}
            >
              {option.tab}
            </Text>
            <View
              className={selected ? "bg-accent" : "bg-transparent"}
              style={{ height: 2, marginTop: CELL / 2 }}
            />
          </Press>
        );
      })}
    </View>
  );
}

/**
 * A song ranking: each row numbered by rank (the top one in ember), with its
 * counted plays beside the artist. Tapping a song plays the ranking from it;
 * long-press opens the song's menu.
 */
export function RankedSongs({
  ranking,
  period,
}: {
  ranking: readonly Ranked<SongRow>[];
  period: StatsPeriod;
}) {
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();
  const songs = ranking.map((entry) => entry.item);
  const context = { kind: "stats", id: `songs-${period}` } as const;
  return (
    <View>
      {ranking.map(({ item: song, countedPlays }, index) => (
        <TrackRow
          key={song.id}
          track={{
            ...toTrackSummary(song),
            artist: `${song.artist} · ${playCount(countedPlays)}`,
            trackNumber: index + 1,
          }}
          state={String(song.id) === currentId ? "playing" : undefined}
          favorite={favorites.has(song.id)}
          leading="number"
          topNumber={index === 0}
          onPress={() => playSongs(songs, index, context)}
          onLongPress={() => openTrackActions(song)}
        />
      ))}
    </View>
  );
}

/**
 * An album ranking: rank, cover, title over the album artist and its counted
 * plays. Tapping opens the album; long-press opens the album's menu.
 */
export function RankedAlbums({ ranking }: { ranking: readonly Ranked<AlbumRow>[] }) {
  return (
    <View>
      {ranking.map(({ item: album, countedPlays }, index) => (
        <ArtworkRow
          key={album.id}
          title={album.title}
          detail={`${album.albumArtist} · ${playCount(countedPlays)}`}
          artworkUri={album.thumbPath === null ? undefined : `file://${album.thumbPath}`}
          rank={{ number: index + 1, top: index === 0 }}
          onPress={() => openAlbum(album.id)}
          onLongPress={() => openAlbumActions(album)}
        />
      ))}
    </View>
  );
}

/**
 * An artist ranking (credited by track artist): rank, name over its counted
 * plays. Tapping opens the artist; long-press opens the artist's menu.
 */
export function RankedArtists({ ranking }: { ranking: readonly Ranked<ArtistRow>[] }) {
  return (
    <View>
      {ranking.map(({ item: artist, countedPlays }, index) => (
        <NameRow
          key={artist.id}
          name={artist.name}
          detail={playCount(countedPlays)}
          rank={{ number: index + 1, top: index === 0 }}
          onPress={() => openArtist(artist.id)}
          onLongPress={() => openArtistActions(artist)}
        />
      ))}
    </View>
  );
}
