import {
  discoverMixCaption,
  discoverRowTitle,
  homeSectionTitle,
  type BlendedDiscoverMix,
  type DiscoverMixesSection,
  type HomeSectionId,
} from "@wave/core";
import { router } from "expo-router";
import { useState, type ComponentType, type ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";

import { AlbumTile } from "@/catalog/AlbumTile";
import { COVER_ROW_TILE } from "@/catalog/CoverRow";
import { Artwork } from "@/catalog/Artwork";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL, grid } from "@/catalog/grid";
import { Press } from "@/motion/Press";
import { Hairline } from "@/catalog/Hairline";
import { PullRefreshRow } from "@/catalog/PullRefreshRow";
import { TitledSection } from "@/catalog/TitledSection";
import { fileUri } from "@/lib/fileUri";
import type { HomeSections, MostPlayedRow } from "@/library/db/playHistory";
import { openStats, openStatsSeeAll } from "@/library/routes";
import type { PlayableSongRow } from "@/library/LibraryStore";
import { Crossfade } from "@/motion/Crossfade";
import { openTrackActions } from "@/playback/ActionsMenu";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import type { Ranked } from "@/stats/Stats";
import { playCount } from "@/stats/StatsViews";
import { openDiscoverMix } from "@/ytmusic/routes";

import { refreshMixes, useDiscoverMixes, type MixSectionId } from "./discoverMixes";
import { openDiscoverMixActions } from "./DiscoverMixActions";
import { DiscoverMixesSkeleton } from "./DiscoverMixesSkeleton";
import { DiscoverSettingsButton } from "./DiscoverSettings";
import {
  startMagicQueueFrom,
  useMagicQueueSection,
  type MagicQueueSection,
} from "./magicQueueSection";
import { useMostPlayedOfAllTime } from "./mostPlayedOfAllTime";

import { AlbumShelf, ArtistShelf, SongRows } from "./HomeSections";
import { ListeningOverview } from "./ListeningOverview";

/** Songs played from Home's lists are queued from the section they were in. */
const MOST_PLAYED_CONTEXT = { kind: "home", id: "most-played" } as const;
const FAVORITES_CONTEXT = { kind: "home", id: "favorites" } as const;

const countedPlays = (entry: { readonly countedPlays: number }): string =>
  playCount(entry.countedPlays);

/** A ranking's entries with their counted plays, as the rows Home's sections take. */
const withPlays = <A,>(ranking: readonly Ranked<A>[] | undefined) =>
  (ranking ?? []).map((entry) => ({ ...entry.item, countedPlays: entry.countedPlays }));

/** The counted plays Most Played is ranked by, shown in each row's trailing cell. */
const plays = (song: MostPlayedRow): number => song.playCount;

type SectionProps = {
  /** Home's lists (`useHome`), read once for every section that shows them. */
  home: HomeSections;
  /** The section's title in Core's catalogue. */
  title: string;
};

function MostPlayedAlbums({ title }: SectionProps) {
  const albums = withPlays(useMostPlayedOfAllTime()?.albums);
  if (albums.length === 0) return null;
  return (
    <TitledSection
      title={title}
      action={{ label: "See all", onPress: () => openStatsSeeAll("albums", "all") }}
    >
      <AlbumShelf albums={albums} detail={countedPlays} />
    </TitledSection>
  );
}

/** The quiet line after a mix row's label while its mixes rebuild over the saved ones. */
const MIXES_UPDATING = "Updating…";

/**
 * Home's Discover section: one header, its adjustments icon opening the
 * settings card all three rows share (`DiscoverSettingsButton`), then the
 * Magic Queue, Artist mixes and Genre mixes rows, each under its label. A
 * row with nothing to show isn't drawn: a mix row shows placeholder tiles
 * while its first mixes build and is gone with YT Music off (Core's
 * `discoverMixesSection`), the Magic Queue row is gone without songs to
 * show. The section is gone only when all three are.
 */
function Discover({ home, title }: SectionProps) {
  const ytMusic = useYtMusicEnabled();
  const played = home.mostPlayed.length > 0;
  const magicQueue = useMagicQueueSection();
  const artistMixes = useDiscoverMixes("artist-mixes", played);
  const genreMixes = useDiscoverMixes("genre-mixes", played);
  const showsMagicQueue = magicQueue !== null && magicQueue.songs.length > 0;
  if (!showsMagicQueue && artistMixes.kind === "hidden" && genreMixes.kind === "hidden")
    return null;
  return (
    <TitledSection title={title} control={<DiscoverSettingsButton ytMusic={ytMusic} />}>
      <View style={{ gap: CELL * 3 }}>
        {showsMagicQueue && <MagicQueueRow section={magicQueue} />}
        <MixRow id="artist-mixes" section={artistMixes} />
        <MixRow id="genre-mixes" section={genreMixes} />
      </View>
    </TitledSection>
  );
}

/**
 * The label over a row of Discover, one level below the section's title,
 * with a quiet [status] after it ("Updating…" while mixes rebuild), read
 * out as it changes.
 */
function DiscoverRowLabel({ children, status }: { children: string; status?: string | undefined }) {
  return (
    <View className="flex-row items-baseline" style={{ gap: CELL }}>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        className="shrink font-sans text-footnote font-medium text-secondary"
      >
        {children}
      </Text>
      {status !== undefined && (
        <Text
          numberOfLines={1}
          accessibilityLiveRegion="polite"
          className="font-sans text-footnote text-secondary"
        >
          {status}
        </Text>
      )}
    </View>
  );
}

/** A row of Discover: its label over its tiles. */
function DiscoverRow({
  label,
  status,
  children,
}: {
  label: string;
  status?: string | undefined;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: CELL }}>
      <DiscoverRowLabel status={status}>{label}</DiscoverRowLabel>
      {children}
    </View>
  );
}

/**
 * A mix row of Discover (Artist mixes or Genre mixes) as covers, each
 * opening its mix's page; placeholder tiles while the first ones build;
 * nothing while [section] is hidden (YT Music off). Its label says
 * "Updating…" while a rebuild runs.
 */
function MixRow({ id, section }: { id: MixSectionId; section: DiscoverMixesSection }) {
  if (section.kind === "hidden") return null;
  const label = discoverRowTitle(id);
  return (
    <DiscoverRow
      label={label}
      status={section.kind === "mixes" && section.updating ? MIXES_UPDATING : undefined}
    >
      {section.kind === "skeleton" ? (
        <DiscoverMixesSkeleton />
      ) : (
        <DiscoverMixRow
          mixes={section.mixes}
          onRefresh={() => refreshMixes(id)}
          refreshing={section.updating}
          refreshLabel={`Get new ${label.toLowerCase()}`}
        />
      )}
    </DiscoverRow>
  );
}

/**
 * A mix row's covers (Artist mixes, Genre mixes). Each place in
 * the row crossfades its tile when what it shows changes: the level
 * re-blending the mix, or a rebuild saving new mixes (a plain swap with
 * reduce motion). Keyed by place, not by mix, so a new set fades over the
 * old one tile by tile. Pulled right past its start, the row asks for new
 * mixes ([onRefresh], `refreshMixes`), except while [refreshing].
 */
function DiscoverMixRow({
  mixes,
  onRefresh,
  refreshing,
  refreshLabel,
}: {
  mixes: readonly BlendedDiscoverMix[];
  onRefresh: () => void;
  refreshing: boolean;
  refreshLabel: string;
}) {
  return (
    <PullRefreshRow onRefresh={onRefresh} enabled={!refreshing} refreshLabel={refreshLabel}>
      {mixes.map((mix, place) => {
        const caption = discoverMixCaption(mix);
        const shows = [mix.id, caption.artworkUrl, caption.title, caption.artists, caption.line];
        return (
          // oxlint-disable-next-line react/no-array-index-key -- a place crossfades from the mix it had to the one it has now
          <Crossfade key={place} swapKey={shows.join("\n")}>
            <AlbumTile
              album={{
                id: mix.id,
                title: caption.title,
                albumArtist: caption.artists,
                trackCount: mix.songs.length,
                durationMs: 0,
                artworkUri: caption.artworkUrl ?? undefined,
              }}
              size={COVER_ROW_TILE}
              detail={caption.line}
              onPress={() => openDiscoverMix(mix.id)}
              onLongPress={() => openDiscoverMixActions(mix)}
            />
          </Crossfade>
        );
      })}
    </PullRefreshRow>
  );
}

/**
 * Discover's Magic Queue row: nine Library songs in an adaptive grid, a tap on one
 * starting a Magic Queue from it, its long-press the song's menu. A new list
 * each day; pulled right past its start, the row brings other songs, with
 * Undo. Each place crossfades its tile when its song changes. With YT Music
 * off it stays, and its queues play from the Library alone.
 */
function MagicQueueRow({ section }: { section: MagicQueueSection }) {
  const { width, fontScale } = useWindowDimensions();
  const [available, setAvailable] = useState(width - grid.margin * 2);
  // Keep text scaling enabled. Larger type gets wider tiles instead of overlapping targets.
  // Android widens a Float to JS, so 1.3 arrives just below the decimal breakpoint.
  const columns = Math.max(
    1,
    Math.min(
      fontScale >= 2 ? 1 : fontScale >= Math.fround(1.3) ? 2 : 3,
      Math.floor((available + CELL) / (CELL * 7)),
    ),
  );
  const size = Math.max(CELL * 6, (available - CELL * (columns - 1)) / columns);
  return (
    <DiscoverRow label={discoverRowTitle("magic-queue")}>
      <View onLayout={(event) => setAvailable(event.nativeEvent.layout.width)}>
        <PullRefreshRow
          onRefresh={section.refresh}
          enabled={!section.picking}
          refreshLabel="Get other songs"
        >
          <View style={{ width: available, flexDirection: "row", flexWrap: "wrap", gap: CELL }}>
            {section.songs.map((song, place) => (
              // oxlint-disable-next-line react/no-array-index-key -- a place crossfades between its previous and next seed
              <Crossfade key={place} swapKey={String(song.id)}>
                <MagicQueueTile song={song} size={size} fontScale={fontScale} />
              </Crossfade>
            ))}
          </View>
        </PullRefreshRow>
      </View>
    </DiscoverRow>
  );
}

/** Title on art; the dark caption plate keeps white text legible over any artwork or placeholder. */
function MagicQueueTile({
  song,
  size,
  fontScale,
}: {
  song: PlayableSongRow;
  size: number;
  fontScale: number;
}) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${song.title} by ${song.artist}, ${song.album}, start Magic Queue`}
      onPress={() => startMagicQueueFrom(song)}
      onLongPress={() => openTrackActions(song)}
      depth={0.02}
      style={{ width: size, minHeight: Math.max(size, 44 * fontScale + CELL * 2) }}
    >
      <View
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={{ flex: 1, minHeight: Math.max(size, 44 * fontScale + CELL * 2) }}
      >
        <View className="absolute inset-0 overflow-hidden bg-fill">
          <Artwork
            uri={fileUri(song.artworkPath ?? song.thumbPath)}
            size={Math.max(size, 44 * fontScale + CELL * 2)}
          />
        </View>
        <View className="mt-auto bg-black/80" style={{ padding: CELL }}>
          <Text numberOfLines={2} className="font-sans text-body font-medium text-white">
            {song.title}
          </Text>
        </View>
      </View>
    </Press>
  );
}

function MostPlayedArtists({ title }: SectionProps) {
  const artists = withPlays(useMostPlayedOfAllTime()?.artists);
  if (artists.length === 0) return null;
  return (
    <TitledSection
      title={title}
      action={{ label: "See all", onPress: () => openStatsSeeAll("artists", "all") }}
    >
      <ArtistShelf artists={artists} detail={countedPlays} />
    </TitledSection>
  );
}

/**
 * How each section of Core's catalogue (`HOME_SECTIONS`) is drawn: nothing
 * when it has nothing to show. A section added to the catalogue needs its
 * entry here (the type insists).
 */
const SECTIONS: Record<HomeSectionId, ComponentType<SectionProps>> = {
  discover: Discover,
  "recently-added": ({ home, title }) =>
    home.recentlyAdded.length > 0 && (
      <TitledSection title={title}>
        <AlbumShelf albums={home.recentlyAdded} />
      </TitledSection>
    ),
  "recently-played": ({ home, title }) =>
    home.recentlyPlayed.length > 0 && (
      <TitledSection title={title}>
        <AlbumShelf albums={home.recentlyPlayed} />
      </TitledSection>
    ),
  "most-played": ({ home, title }) =>
    home.mostPlayed.length > 0 && (
      <TitledSection title={title}>
        <SongRows songs={home.mostPlayed} context={MOST_PLAYED_CONTEXT} plays={plays} />
      </TitledSection>
    ),
  "most-played-albums": MostPlayedAlbums,
  "most-played-artists": MostPlayedArtists,
  favorites: ({ home, title }) =>
    home.favorites.length > 0 && (
      <TitledSection
        title={title}
        action={{ label: "See all", onPress: () => router.push("/library/favorites") }}
      >
        <SongRows songs={home.favorites} context={FAVORITES_CONTEXT} />
      </TitledSection>
    ),
  stats: ({ title }) => (
    <View style={{ marginTop: CELL * 5 }}>
      <Hairline />
      <EntryRow label={title} onPress={openStats} />
    </View>
  ),
  "listening-overview": ListeningOverview,
};

/** Space above every section but the first on a screen: what `TitledSection` puts there. */
export const SECTION_GAP = CELL * 5;

/**
 * The section [id] of Home's catalogue with its data, or nothing when it has
 * nothing to show. Every section leaves `SECTION_GAP` above itself, so it can
 * sit under any screen's content (Home, or the Library under its rows).
 * [home] is `useHome`'s answer.
 */
export function HomeSection({ id, home }: { id: HomeSectionId; home: HomeSections }) {
  const Section = SECTIONS[id];
  return <Section home={home} title={homeSectionTitle(id)} />;
}
