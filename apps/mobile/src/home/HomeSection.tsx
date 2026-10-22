import {
  discoverMixCaption,
  discoverRowTitle,
  homeSectionTitle,
  type BlendedDiscoverMix,
  type DiscoverMixesSection,
  type HomeSectionId,
} from "@wave/core";
import { router } from "@/lib/timingRouter";
import { useState, type ComponentType, type ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";

import { COVER_ROW_TILE } from "@/catalog/CoverRow";
import { EntryRow } from "@/catalog/EntryRow";
import { PlaylistCard } from "@/catalog/cards/PlaylistCard";
import { SongCard } from "@/catalog/cards/SongCard";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { PullRefreshRow } from "@/catalog/PullRefreshRow";
import { TitledSection } from "@/catalog/TitledSection";
import { fileUri } from "@/lib/fileUri";
import type { MostPlayedRow } from "@/library/db/playHistory";
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
import { HomeSectionBody, HomeSectionSkeleton, MagicQueueSkeleton } from "./HomeSectionSkeleton";
import {
  homeOpeningState,
  homeSectionWaiting,
  magicQueueGrid,
  type HomeContent,
} from "./homeOpening";

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
  home: HomeContent;
  /** The section's title in Core's catalogue. */
  title: string;
};

function MostPlayedAlbums({ title }: SectionProps) {
  const ranking = useMostPlayedOfAllTime();
  if (ranking === undefined) return <HomeSectionSkeleton id="most-played-albums" />;
  const albums = withPlays(ranking.albums);
  if (albums.length === 0) return null;
  return (
    <TitledSection
      title={title}
      action={{ label: "See all", onPress: () => openStatsSeeAll("albums", "all") }}
    >
      <HomeSectionBody id="most-played-albums">
        <AlbumShelf albums={albums} detail={countedPlays} />
      </HomeSectionBody>
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
  const { played } = homeOpeningState(home);
  const magicQueue = useMagicQueueSection();
  const artistMixes = useDiscoverMixes("artist-mixes", played);
  const genreMixes = useDiscoverMixes("genre-mixes", played);
  const showsMagicQueue = magicQueue !== null && magicQueue.songs.length > 0;
  if (
    magicQueue !== null &&
    !showsMagicQueue &&
    artistMixes.kind === "hidden" &&
    genreMixes.kind === "hidden"
  )
    return null;
  return (
    <TitledSection title={title} control={<DiscoverSettingsButton ytMusic={ytMusic} />}>
      <View style={{ gap: CELL * 3 }}>
        {magicQueue === null ? (
          <DiscoverRow label={discoverRowTitle("magic-queue")}>
            <MagicQueueSkeleton />
          </DiscoverRow>
        ) : (
          showsMagicQueue && <MagicQueueRow section={magicQueue} />
        )}
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
 * A mix row of Discover (Artist mixes or Genre mixes) as playlist cards, each
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
 * A mix row's cards (Artist mixes, Genre mixes). Each place in
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
            <PlaylistCard
              name={caption.title}
              detail={caption.line}
              paths={caption.artworkUrl === null ? [] : [caption.artworkUrl]}
              size={COVER_ROW_TILE}
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
  const { size, height } = magicQueueGrid(available, fontScale);
  return (
    <DiscoverRow label={discoverRowTitle("magic-queue")}>
      <View onLayout={(event) => setAvailable(event.nativeEvent.layout.width)}>
        <PullRefreshRow
          onRefresh={section.refresh}
          enabled={!section.picking}
          refreshLabel="Get other songs"
        >
          <View
            style={{
              width: available,
              minHeight: height,
              flexDirection: "row",
              flexWrap: "wrap",
              gap: CELL,
            }}
          >
            {section.songs.map((song, place) => (
              // oxlint-disable-next-line react/no-array-index-key -- a place crossfades between its previous and next seed
              <Crossfade key={place} swapKey={String(song.id)}>
                <MagicQueueTile song={song} size={size} />
              </Crossfade>
            ))}
          </View>
        </PullRefreshRow>
      </View>
    </DiscoverRow>
  );
}

/** A Magic Queue's song as a song card in its grid column; a tap starts the Magic Queue from it. */
function MagicQueueTile({ song, size }: { song: PlayableSongRow; size: number }) {
  return (
    <SongCard
      title={song.title}
      artist={song.artist}
      artworkUri={fileUri(song.artworkPath ?? song.thumbPath)}
      size={size}
      label={`${song.title} by ${song.artist}, ${song.album}, start Magic Queue`}
      onPress={() => startMagicQueueFrom(song)}
      onLongPress={() => openTrackActions(song)}
    />
  );
}

function MostPlayedArtists({ title }: SectionProps) {
  const ranking = useMostPlayedOfAllTime();
  if (ranking === undefined) return <HomeSectionSkeleton id="most-played-artists" />;
  const artists = ranking.artists.map((entry) => entry.item);
  if (artists.length === 0) return null;
  return (
    <TitledSection
      title={title}
      action={{ label: "See all", onPress: () => openStatsSeeAll("artists", "all") }}
    >
      <HomeSectionBody id="most-played-artists">
        <ArtistShelf artists={artists} />
      </HomeSectionBody>
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
    home.recentlyAdded !== undefined &&
    home.recentlyAdded.length > 0 && (
      <TitledSection title={title}>
        <HomeSectionBody id="recently-added">
          <AlbumShelf albums={home.recentlyAdded} />
        </HomeSectionBody>
      </TitledSection>
    ),
  "recently-played": ({ home, title }) =>
    home.recentlyPlayed !== undefined &&
    home.recentlyPlayed.length > 0 && (
      <TitledSection title={title}>
        <HomeSectionBody id="recently-played">
          <AlbumShelf albums={home.recentlyPlayed} />
        </HomeSectionBody>
      </TitledSection>
    ),
  "most-played": ({ home, title }) =>
    home.mostPlayed !== undefined &&
    home.mostPlayed.length > 0 && (
      <TitledSection title={title}>
        <HomeSectionBody id="most-played">
          <SongRows songs={home.mostPlayed} context={MOST_PLAYED_CONTEXT} plays={plays} />
        </HomeSectionBody>
      </TitledSection>
    ),
  "most-played-albums": MostPlayedAlbums,
  "most-played-artists": MostPlayedArtists,
  favorites: ({ home, title }) =>
    home.favorites !== undefined &&
    home.favorites.length > 0 && (
      <TitledSection
        title={title}
        action={{ label: "See all", onPress: () => router.push("/library/favorites") }}
      >
        <HomeSectionBody id="favorites">
          <SongRows songs={home.favorites} context={FAVORITES_CONTEXT} />
        </HomeSectionBody>
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
export function HomeSection({ id, home }: { id: HomeSectionId; home: HomeContent }) {
  if (homeSectionWaiting(id, home)) return <HomeSectionSkeleton id={id} />;
  const Section = SECTIONS[id];
  return <Section home={home} title={homeSectionTitle(id)} />;
}
