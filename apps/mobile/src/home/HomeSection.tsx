import { useLocalisation } from "@/localisation/localisation";
import { NewReleases } from "./NewReleases";
import {
  discoverMixCaption,
  discoverMixRowsToBuild,
  discoverRowTitle,
  homeSectionTitle,
  MAGIC_QUEUE_PICKS,
  ytSongArtist,
  type BlendedDiscoverMix,
  type DiscoverMixesSection,
  type HomeSectionId,
  type YtAlbumSong,
} from "@wave/core";
import { router } from "@/lib/timingRouter";
import { useState, type ComponentType, type ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";

import { artworkUri } from "@/catalog/artworkUri";
import { COVER_ROW_TILE } from "@/catalog/CoverRow";
import { PlaylistCard } from "@/catalog/cards/PlaylistCard";
import { SongCard } from "@/catalog/cards/SongCard";
import { CELL, grid } from "@/catalog/grid";
import { PullRefreshRow } from "@/catalog/PullRefreshRow";
import { SkeletonGroup, SongCardSkeleton } from "@/catalog/Skeletons";
import { TitledSection } from "@/catalog/TitledSection";
import { RecommendationsFailed } from "@/components/RecommendationsFailed";
import { openStatsSeeAll } from "@/library/routes";
import type { PlayableSongRow } from "@/library/LibraryStore";
import { Crossfade } from "@/motion/Crossfade";
import { openTrackActions } from "@/playback/ActionsMenu";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import type { Ranked } from "@/stats/Stats";
import { openDiscoverMix } from "@/ytmusic/routes";
import { openYtSongActions } from "@/ytmusic/YtSongActions";

import {
  refreshMixes,
  useDiscoverMixes,
  useDiscoverMixesFocus,
  type MixSectionId,
} from "./discoverMixes";
import { openDiscoverMixActions } from "./DiscoverMixActions";
import { DiscoverMixesSkeleton } from "./DiscoverMixesSkeleton";
import { DiscoverSettingsButton } from "./DiscoverSettings";
import { discoverRefreshAccessibility, type DiscoverRefresh } from "./discoverRefresh";
import {
  startMagicQueueFrom,
  startStreamedMagicQueueFrom,
  useMagicQueueSection,
  type MagicQueueSection,
} from "./magicQueueSection";
import { useHomeArrangement } from "./homeArrangement";
import { useMostPlayedOfAllTime } from "./mostPlayedOfAllTime";

import { AlbumShelf, ArtistShelf, MostPlayedRows, SongRows } from "./HomeSections";
import { HomeStats } from "./HomeStats";
import { HomeSectionSkeleton } from "./HomeSectionSkeleton";
import {
  homeOpeningState,
  homeSectionWaiting,
  magicQueueGrid,
  type HomeContent,
} from "./homeOpening";

/** Songs played from Home's lists are queued from the section they were in. */
const MOST_PLAYED_CONTEXT = { kind: "home", id: "most-played" } as const;
const FAVORITES_CONTEXT = { kind: "home", id: "favorites" } as const;

/** A ranking's entries with their counted plays, as the rows Home's sections take. */
const withPlays = <A,>(ranking: readonly Ranked<A>[] | undefined) =>
  (ranking ?? []).map((entry) => ({ ...entry.item, countedPlays: entry.countedPlays }));

type SectionProps = {
  /** Home's lists (`useHome`), read once for every section that shows them. */
  home: HomeContent;
  /** The section's title in Core's catalogue. */
  title: string;
};

function MostPlayedAlbums({ title }: SectionProps) {
  const { strings } = useLocalisation();
  const ranking = useMostPlayedOfAllTime();
  if (ranking === undefined) return <HomeSectionSkeleton id="most-played-albums" />;
  const albums = withPlays(ranking.albums);
  if (albums.length === 0) return null;
  return (
    <TitledSection
      title={title}
      action={{ label: strings.home.seeAll, onPress: () => openStatsSeeAll("albums", "all") }}
    >
      <AlbumShelf albums={albums} detail={(album) => strings.stats.plays(album.countedPlays)} />
    </TitledSection>
  );
}

/**
 * Home's Discover section: one header, its adjustments icon opening the
 * settings card all three rows share (`DiscoverSettingsButton`), then the
 * rows in the owner's order, each under its label. A row with nothing to show isn't drawn: a mix row shows placeholder tiles
 * while its first mixes build and is gone with YT Music off (Core's
 * `discoverMixesSection`), the Magic Queue row is gone without songs to
 * show (Core's `magicQueueRow`). The section is gone when every arranged row is gone.
 */
function Discover({ home, title }: SectionProps) {
  const ytMusic = useYtMusicEnabled();
  const { played, empty } = homeOpeningState(home);
  const { discoverRows } = useHomeArrangement();
  const builds = discoverMixRowsToBuild(discoverRows, { empty });
  useDiscoverMixesFocus(ytMusic, played, empty);
  const artistMixes = useDiscoverMixes("artist-mixes", empty, builds.includes("artist-mixes"));
  // An empty Library has no tagged songs: Genre mixes stay hidden, no skeleton.
  const genreMixes = useDiscoverMixes("genre-mixes", empty, builds.includes("genre-mixes"));
  const magicQueue = useMagicQueueSection(
    ytMusic && discoverRows.includes("magic-queue"),
    artistMixes,
  );
  const rows = discoverRows.filter((id) =>
    id === "magic-queue"
      ? magicQueue.shown.kind !== "hidden"
      : (id === "artist-mixes" ? artistMixes : genreMixes).kind !== "hidden",
  );
  if (rows.length === 0) return null;
  return (
    <TitledSection title={title} control={<DiscoverSettingsButton ytMusic={ytMusic} />}>
      <View style={{ gap: CELL * 3 }}>
        {rows.map((id) =>
          id === "magic-queue" ? (
            <MagicQueueRow key={id} section={magicQueue} />
          ) : (
            <MixRow key={id} id={id} section={id === "artist-mixes" ? artistMixes : genreMixes} />
          ),
        )}
      </View>
    </TitledSection>
  );
}

/**
 * The label over a row of Discover, one level below the section's title,
 * with a quiet [status] after it ("Updating…" while mixes rebuild), read
 * out as it changes.
 */
function DiscoverRowLabel({
  children,
  status,
  refresh,
  busy,
}: {
  children: string;
  status?: string | undefined;
  refresh?: DiscoverRefresh | undefined;
  busy?: boolean | undefined;
}) {
  return (
    <View className="flex-row flex-wrap items-baseline" style={{ gap: CELL }}>
      <Text
        accessible
        accessibilityRole="header"
        accessibilityState={{ busy }}
        {...discoverRefreshAccessibility(refresh)}
        className="max-w-full font-sans text-footnote font-medium text-secondary"
      >
        {children}
      </Text>
      {status !== undefined && (
        <Text
          accessibilityLiveRegion="polite"
          className="max-w-full font-sans text-footnote text-secondary"
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
  refresh,
  busy,
  children,
}: {
  label: string;
  status?: string | undefined;
  refresh?: DiscoverRefresh | undefined;
  busy?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: CELL }}>
      <DiscoverRowLabel status={status} refresh={refresh} busy={busy}>
        {label}
      </DiscoverRowLabel>
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
  const { strings } = useLocalisation();
  if (section.kind === "hidden") return null;
  const label = discoverRowTitle(id, strings);
  const refresh = () => refreshMixes(id);
  const updating = section.kind === "skeleton" || (section.kind === "mixes" && section.updating);
  return (
    <DiscoverRow
      label={label}
      status={section.kind === "mixes" && section.updating ? strings.discover.updating : undefined}
      busy={updating}
      refresh={{ label: strings.discover.refresh[id], run: refresh, enabled: !updating }}
    >
      {section.kind === "skeleton" ? (
        <DiscoverMixesSkeleton />
      ) : section.kind === "mixes" ? (
        <DiscoverMixRow mixes={section.mixes} onRefresh={refresh} refreshing={section.updating} />
      ) : null}
      {section.failed && <RecommendationsFailed onRetry={refresh} />}
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
}: {
  mixes: readonly BlendedDiscoverMix[];
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { strings } = useLocalisation();
  return (
    <PullRefreshRow onRefresh={onRefresh} enabled={!refreshing}>
      {mixes.map((mix, place) => {
        const caption = discoverMixCaption(mix, strings);
        const shows = [mix.id, caption.artworkUrl, caption.title, caption.artists, caption.line];
        return (
          // oxlint-disable-next-line react/no-array-index-key -- a place crossfades from the mix it had to the one it has now
          <Crossfade key={place} swapKey={shows.join("\n")}>
            <PlaylistCard
              name={caption.title}
              label={[caption.title, caption.artists, caption.line].filter(Boolean).join(", ")}
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
 * Discover's Magic Queue row: nine songs in an adaptive grid, a tap on one
 * starting a Magic Queue from it, its long-press the song's menu. The
 * Library's songs, or with none, streamed songs of the Artist mixes, with
 * placeholder tiles while the first mixes build. A new list each visit;
 * pulled right past its start, the row brings other songs, with Undo. Each
 * place crossfades its tile when its song changes. Hidden with YT Music off.
 */
function MagicQueueRow({ section }: { section: MagicQueueSection }) {
  const { strings } = useLocalisation();
  const { width, fontScale } = useWindowDimensions();
  const [available, setAvailable] = useState(width - grid.margin * 2);
  const { size } = magicQueueGrid(available, fontScale);
  const { shown } = section;
  const tiles =
    shown.kind === "library"
      ? shown.songs.map((song) => ({
          key: String(song.id),
          tile: <LibraryTile song={song} size={size} />,
        }))
      : shown.kind === "mixes"
        ? shown.songs.map((song) => ({
            key: song.videoId,
            tile: <StreamedTile song={song} size={size} />,
          }))
        : [];
  const skeleton = shown.kind === "skeleton";
  return (
    <DiscoverRow
      label={discoverRowTitle("magic-queue", strings)}
      busy={skeleton}
      refresh={{ label: strings.discover.otherSongs, run: section.refresh, enabled: !skeleton }}
    >
      <View onLayout={(event) => setAvailable(event.nativeEvent.layout.width)}>
        {skeleton ? (
          <SkeletonGroup label={strings.discover.findingSongs}>
            <MagicQueueGrid width={available}>
              {Array.from({ length: MAGIC_QUEUE_PICKS }, (_, place) => (
                <SongCardSkeleton key={place} size={size} fontScale={fontScale} />
              ))}
            </MagicQueueGrid>
          </SkeletonGroup>
        ) : (
          <PullRefreshRow onRefresh={section.refresh} enabled>
            <MagicQueueGrid width={available}>
              {tiles.map(({ key, tile }, place) => (
                // oxlint-disable-next-line react/no-array-index-key -- a place crossfades between its previous and next seed
                <Crossfade key={place} swapKey={key}>
                  {tile}
                </Crossfade>
              ))}
            </MagicQueueGrid>
          </PullRefreshRow>
        )}
      </View>
    </DiscoverRow>
  );
}

/** The Magic Queue row's wrapping grid, [width] wide. */
function MagicQueueGrid({ width, children }: { width: number; children: ReactNode }) {
  return (
    <View style={{ width, flexDirection: "row", flexWrap: "wrap", gap: CELL }}>{children}</View>
  );
}

/** A Library song as a song card in its grid column; a tap starts the Magic Queue from it. */
function LibraryTile({ song, size }: { song: PlayableSongRow; size: number }) {
  const { strings } = useLocalisation();
  return (
    <SongCard
      title={song.title}
      artist={song.artist}
      artworkUri={artworkUri(song, "medium")}
      size={size}
      label={strings.discover.startMagicQueue(song.title, song.artist, song.album)}
      onPress={() => startMagicQueueFrom(song)}
      onLongPress={() => openTrackActions(song)}
    />
  );
}

/** A mix's streamed song as a song card; a tap starts the Magic Queue from its radio. */
function StreamedTile({ song, size }: { song: YtAlbumSong; size: number }) {
  const { strings } = useLocalisation();
  const artist = ytSongArtist(song);
  return (
    <SongCard
      title={song.title}
      artist={artist}
      artworkUri={song.artworkUrl ?? undefined}
      size={size}
      label={strings.discover.startMagicQueue(song.title, artist, song.album)}
      onPress={() => startStreamedMagicQueueFrom(song)}
      onLongPress={() => openYtSongActions(song)}
    />
  );
}

function Favorites({ home, title }: SectionProps) {
  const { strings } = useLocalisation();
  if (home.favorites === undefined || home.favorites.length === 0) return null;
  return (
    <TitledSection
      title={title}
      action={{ label: strings.home.seeAll, onPress: () => router.push("/library/favorites") }}
    >
      <SongRows songs={home.favorites} context={FAVORITES_CONTEXT} />
    </TitledSection>
  );
}

function MostPlayedArtists({ title }: SectionProps) {
  const { strings } = useLocalisation();
  const ranking = useMostPlayedOfAllTime();
  if (ranking === undefined) return <HomeSectionSkeleton id="most-played-artists" />;
  const artists = ranking.artists.map((entry) => entry.item);
  if (artists.length === 0) return null;
  return (
    <TitledSection
      title={title}
      action={{ label: strings.home.seeAll, onPress: () => openStatsSeeAll("artists", "all") }}
    >
      <ArtistShelf artists={artists} />
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
  "new-releases": NewReleases,
  "recently-added": ({ home, title }) =>
    home.recentlyAdded !== undefined &&
    home.recentlyAdded.length > 0 && (
      <TitledSection title={title}>
        <AlbumShelf albums={home.recentlyAdded} />
      </TitledSection>
    ),
  "recently-played": ({ home, title }) =>
    home.recentlyPlayed !== undefined &&
    home.recentlyPlayed.length > 0 && (
      <TitledSection title={title}>
        <AlbumShelf albums={home.recentlyPlayed} />
      </TitledSection>
    ),
  "most-played": ({ home, title }) =>
    home.mostPlayed !== undefined &&
    home.mostPlayed.length > 0 && (
      <TitledSection title={title}>
        <MostPlayedRows rows={home.mostPlayed} context={MOST_PLAYED_CONTEXT} />
      </TitledSection>
    ),
  "most-played-albums": MostPlayedAlbums,
  "most-played-artists": MostPlayedArtists,
  favorites: Favorites,
  stats: HomeStats,
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
  const { strings } = useLocalisation();
  if (homeSectionWaiting(id, home)) return <HomeSectionSkeleton id={id} />;
  const Section = SECTIONS[id];
  return <Section home={home} title={homeSectionTitle(id, strings)} />;
}
