import { HomeFollowProvider, useHomeFollowPresence } from "./useHomeFollow";
import { useLocalisation } from "@/localisation/localisation";
import { NewReleases } from "./NewReleases";
import { UpcomingShows } from "./UpcomingShows";
import {
  discoverMixCaption,
  discoverMixRowsToBuild,
  discoverRowTitle,
  homeSectionTitle,
  MAGIC_QUEUE_PICKS,
  magicQueueCarouselPage,
  magicQueueCarouselKeptPage,
  magicQueueCarouselPageLabel,
  magicQueueCarouselPages,
  magicQueueCarouselPageTitle,
  ytSongArtist,
  ytTrackId,
  type BlendedDiscoverMix,
  type DiscoverMixesSection,
  type HomeSectionId,
  type MagicQueueCarouselPageId,
  type MagicQueueSeed,
  type YtAlbumSong,
} from "@wave/core";
import { router } from "@/lib/timingRouter";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { AccessibilityInfo, Text, View, useWindowDimensions } from "react-native";
import { IconRefresh } from "@tabler/icons-react-native";

import { artworkUri } from "@wave/client/artworkUri";
import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { PlaylistCard } from "@/catalog/cards/PlaylistCard";
import { SongCard } from "@/catalog/cards/SongCard";
import { CELL, grid } from "@/catalog/grid";
import { PullRefreshRow } from "@/catalog/PullRefreshRow";
import { SkeletonGroup, SongCardSkeleton } from "@/catalog/Skeletons";
import { TitledSection } from "@/catalog/TitledSection";
import { IconButton } from "@/components/IconButton";
import { RecommendationsFailed } from "@/components/RecommendationsFailed";
import { openPlaylist, openStatsSeeAll } from "@/library/routes";
import { songCount } from "@/library/TrackList";
import type { PlayableSongRow } from "@wave/client";
import { Crossfade } from "@/motion/Crossfade";
import { openPlaylistActions, openTrackActions } from "@/playback/ActionsMenu";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import type { Ranked } from "@/stats/Stats";
import { openDiscoverMix, openYtPlaylist } from "@/ytmusic/routes";
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
import { DjCard } from "./DjCard";
import { discoverRefreshAccessibility, type DiscoverRefresh } from "./discoverRefresh";
import {
  startMagicQueueFrom,
  startStreamedMagicQueueFrom,
  useMagicQueueSection,
  type MagicQueueSection,
  type MagicQueueShown,
} from "./magicQueueSection";
import { useCommunityPlaylists } from "./communityPlaylists";
import { useFromYourLibrary } from "./fromYourLibrary";
import { CarouselPageDots, MagicQueueCarousel } from "./MagicQueueCarousel";
import { useDiscoveries } from "./discoveries";
import { useMostListenedRecently } from "./mostListenedRecently";
import { useHomeArrangement } from "./homeArrangement";
import { useInYourOrbit } from "./inYourOrbit";
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
 * settings card all three rows share (`DiscoverSettingsButton`), the DJ card
 * while YT Music is on, then the rows in the owner's order, each under its label. A row with nothing to show isn't drawn: a mix row shows placeholder tiles
 * while its first mixes build and is gone with YT Music off (Core's
 * `discoverMixesSection`), the Magic Queue row is gone while none of its
 * carousel's pages has songs to show (Core's `magicQueueCarouselPages`), and
 * until Most listened recently is first read, so the row opens on its pages
 * as they are; Discoveries, the last page, joins once it's read. The section
 * is gone when every arranged row is gone and YT Music is off, which hides
 * the DJ card.
 */
function Discover({ home, title }: SectionProps) {
  const ytMusic = useYtMusicEnabled();
  const { played, empty } = homeOpeningState(home);
  const { discoverRows } = useHomeArrangement();
  const builds = discoverMixRowsToBuild(discoverRows, { empty });
  useDiscoverMixesFocus(ytMusic, played, empty);
  // An empty Library's Magic Queue builds Artist mixes even when the row is removed.
  const artistMixes = useDiscoverMixes(
    "artist-mixes",
    empty,
    builds.includes("artist-mixes"),
    discoverRows.includes("artist-mixes"),
  );
  // An empty Library has no tagged songs: Genre mixes stay hidden, no skeleton.
  const genreMixes = useDiscoverMixes("genre-mixes", empty, builds.includes("genre-mixes"));
  const magicQueueOn = ytMusic && discoverRows.includes("magic-queue");
  const magicQueue = useMagicQueueSection(magicQueueOn, artistMixes);
  const recent = useMostListenedRecently(magicQueueOn);
  const discoveries = useDiscoveries(magicQueueOn);
  const pages =
    recent === undefined
      ? []
      : magicQueueCarouselPages({
          "most-listened-recently": recent.length,
          "magic-queue": magicQueueTiles(magicQueue.shown),
          discoveries: discoveries.length,
        });
  const rows = discoverRows.filter((id) =>
    id === "magic-queue"
      ? pages.length > 0
      : (id === "artist-mixes" ? artistMixes : genreMixes).kind !== "hidden",
  );
  if (rows.length === 0 && !ytMusic) return null;
  return (
    <TitledSection title={title} control={<DiscoverSettingsButton ytMusic={ytMusic} />}>
      <View style={{ gap: CELL * 3 }}>
        {ytMusic && <DjCard />}
        {rows.map((id) =>
          id === "magic-queue" ? (
            <MagicQueueRow
              key={id}
              section={magicQueue}
              recent={recent ?? []}
              discoveries={discoveries}
              pages={pages}
            />
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

/** A row of Discover: its label over its tiles, with what [trailing] puts at the label's right. */
function DiscoverRow({
  label,
  status,
  refresh,
  busy,
  trailing,
  children,
}: {
  label: string;
  status?: string | undefined;
  refresh?: DiscoverRefresh | undefined;
  busy?: boolean | undefined;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const heading = (
    <DiscoverRowLabel status={status} refresh={refresh} busy={busy}>
      {label}
    </DiscoverRowLabel>
  );
  return (
    <View style={{ gap: CELL }}>
      {trailing === undefined ? (
        heading
      ) : (
        <View className="flex-row items-center justify-between" style={{ gap: CELL }}>
          <View style={{ flexShrink: 1 }}>{heading}</View>
          {trailing}
        </View>
      )}
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

/** How many tiles the Magic Queue page has to show, placeholders included: none while hidden. */
const magicQueueTiles = (shown: MagicQueueShown): number =>
  shown.kind === "hidden"
    ? 0
    : shown.kind === "skeleton"
      ? MAGIC_QUEUE_PICKS
      : shown.kind === "seeds"
        ? shown.seeds.length
        : shown.songs.length;

/** The page the carousel last showed, kept while the app runs: coming back to Home finds it there. */
let keptPage: MagicQueueCarouselPageId | null = null;

/** As tall as the refresh button, so the label line keeps its height from page to page. */
const CAROUSEL_CONTROLS = CELL * 4;

/** A page's songs as the tiles of its grid, each under the key its place crossfades by. */
const seedTiles = (seeds: readonly MagicQueueSeed<PlayableSongRow>[], size: number) =>
  seeds.map((seed) =>
    seed.source === "library"
      ? { key: String(seed.song.id), tile: <LibraryTile song={seed.song} size={size} /> }
      : { key: ytTrackId(seed.song.videoId), tile: <StreamedTile song={seed.song} size={size} /> },
  );

/**
 * Discover's Magic Queue row, a carousel of [pages] (Core's
 * `magicQueueCarouselPages`) swiped sideways, each up to nine songs in an
 * adaptive grid, a tap on one starting a Magic Queue from it, its long-press
 * the song's menu. The label names the page in sight and dots beside it show
 * where it sits; TalkBack hears the page's name as it changes and moves
 * between pages by adjusting the dots. The row comes back on the page it was
 * left on. With one page there are no dots and nothing to swipe.
 *
 * Most listened recently holds [recent], the songs played most in the last
 * 14 days, and Discoveries holds [discoveries], songs never played. The Magic
 * Queue page holds the Library's songs and the playlists'
 * YT Music entries, or with neither, streamed songs of the Artist mixes, with
 * placeholder tiles while the first mixes build; a new list each app start. Alone,
 * it brings other songs when pulled right past its start, with Undo; after
 * another page that pull is the swipe back, so a refresh button sits by the
 * dots. Each place crossfades its tile when its song changes. Hidden with YT
 * Music off.
 */
function MagicQueueRow({
  section,
  recent,
  discoveries,
  pages,
}: {
  section: MagicQueueSection;
  recent: readonly MagicQueueSeed<PlayableSongRow>[];
  discoveries: readonly MagicQueueSeed<PlayableSongRow>[];
  pages: readonly MagicQueueCarouselPageId[];
}) {
  const { strings } = useLocalisation();
  const { width, fontScale } = useWindowDimensions();
  const [available, setAvailable] = useState(width - grid.margin * 2);
  const [kept, setKept] = useState(keptPage);
  // The first page drawn is remembered as a swiped-to one is: a page that joins before it
  // then moves the row, and the page in sight stays.
  const remembered = magicQueueCarouselKeptPage(pages, kept);
  if (remembered !== kept) setKept(remembered);
  useEffect(() => {
    if (remembered !== null) keptPage = remembered;
  }, [remembered]);
  const { size } = magicQueueGrid(available, fontScale);
  const { shown } = section;
  const index = magicQueueCarouselPage(pages, remembered);
  const current = pages[index];
  if (current === undefined) return null;
  const paged = pages.length > 1;
  const show = (next: number) => {
    const page = pages[next];
    if (page === undefined) return;
    keptPage = page;
    setKept(page);
    AccessibilityInfo.announceForAccessibility(magicQueueCarouselPageLabel(pages, next, strings));
  };
  const skeleton = shown.kind === "skeleton";
  const refreshes = current === "magic-queue" && !skeleton;
  const tiles = (songs: readonly { key: string; tile: ReactNode }[]) => (
    <MagicQueueGrid width={available}>
      {songs.map(({ key, tile }, place) => (
        // oxlint-disable-next-line react/no-array-index-key -- a place crossfades between its previous and next song
        <Crossfade key={place} swapKey={key}>
          {tile}
        </Crossfade>
      ))}
    </MagicQueueGrid>
  );
  const magicQueueSongs =
    shown.kind === "seeds"
      ? seedTiles(shown.seeds, size)
      : shown.kind === "mixes"
        ? shown.songs.map((song) => ({
            key: song.videoId,
            tile: <StreamedTile song={song} size={size} />,
          }))
        : [];
  const page = (id: MagicQueueCarouselPageId): ReactNode => {
    if (id === "most-listened-recently") return tiles(seedTiles(recent, size));
    if (id === "discoveries") return tiles(seedTiles(discoveries, size));
    if (skeleton)
      return (
        <SkeletonGroup label={strings.discover.findingSongs}>
          <MagicQueueGrid width={available}>
            {Array.from({ length: MAGIC_QUEUE_PICKS }, (_, place) => (
              <SongCardSkeleton key={place} size={size} fontScale={fontScale} />
            ))}
          </MagicQueueGrid>
        </SkeletonGroup>
      );
    return paged ? (
      tiles(magicQueueSongs)
    ) : (
      <PullRefreshRow onRefresh={section.refresh} enabled>
        {tiles(magicQueueSongs)}
      </PullRefreshRow>
    );
  };
  return (
    <DiscoverRow
      label={magicQueueCarouselPageTitle(current, strings)}
      busy={current === "magic-queue" && skeleton}
      refresh={{ label: strings.discover.otherSongs, run: section.refresh, enabled: refreshes }}
      trailing={
        paged ? (
          <View
            className="flex-row items-center"
            style={{ gap: CELL, minHeight: CAROUSEL_CONTROLS }}
          >
            {refreshes && (
              <IconButton
                icon={IconRefresh}
                label={strings.discover.otherSongs}
                size={CAROUSEL_CONTROLS}
                iconSize={CELL * 2.5}
                tone="secondary"
                hitSlop={CELL}
                onPress={section.refresh}
              />
            )}
            <CarouselPageDots
              count={pages.length}
              index={index}
              label={magicQueueCarouselPageLabel(pages, index, strings)}
              onIndex={show}
            />
          </View>
        ) : undefined
      }
    >
      <View onLayout={(event) => setAvailable(event.nativeEvent.layout.width)}>
        {paged ? (
          <MagicQueueCarousel
            pages={pages.map((id) => ({ key: id, content: page(id) }))}
            index={index}
            onIndex={show}
            width={available}
          />
        ) : (
          page(current)
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

/** A streamed song (a mix's or a playlist's) as a song card; a tap starts the Magic Queue from its radio. */
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
 * In your orbit: the artists played most in the last 14 days, as circles in
 * one row. A tap opens the artist's page, the Library's or the online one by
 * name (`PlayedArtistCard`).
 */
function InYourOrbit({ title }: SectionProps) {
  const artists = useInYourOrbit();
  if (artists === undefined) return <HomeSectionSkeleton id="in-your-orbit" />;
  if (artists.length === 0) return null;
  return (
    <TitledSection title={title}>
      <ArtistShelf artists={artists} />
    </TitledSection>
  );
}

/**
 * From your library: the owner's most played playlists as cards in one row,
 * those played in the last 14 days first (Core's `fromYourLibrary`). A tap
 * opens the playlist, a long press its menu.
 */
function FromYourLibrary({ title }: SectionProps) {
  const { strings } = useLocalisation();
  const playlists = useFromYourLibrary();
  if (playlists === undefined) return <HomeSectionSkeleton id="from-your-library" />;
  if (playlists.length === 0) return null;
  return (
    <TitledSection title={title}>
      <CoverRow>
        {playlists.map((playlist) => (
          <PlaylistCard
            key={playlist.id}
            name={playlist.name}
            detail={songCount(playlist.trackCount, strings)}
            paths={playlist.thumbPaths}
            size={COVER_ROW_TILE}
            onPress={() => openPlaylist(playlist.id, playlist)}
            onLongPress={() => openPlaylistActions(playlist)}
          />
        ))}
      </CoverRow>
    </TitledSection>
  );
}

/** A community playlist YouTube Music lists no cover for. */
const NO_COVERS: readonly string[] = [];

/**
 * Community playlists: the playlists of the shelves YouTube Music shows on
 * the connected account's home, as playlist cards in one row (Core's
 * `homeCommunityPlaylistsShown`), each with its author under its title. A tap
 * opens the playlist's page. Left out signed out and with nothing kept; the
 * kept list shows at once, so there is no skeleton.
 */
function CommunityPlaylists({ title }: SectionProps) {
  const playlists = useCommunityPlaylists();
  if (playlists.length === 0) return null;
  return (
    <TitledSection title={title}>
      <CoverRow>
        {playlists.map((playlist) => {
          const author = playlist.author ?? "";
          return (
            <PlaylistCard
              key={playlist.playlistId}
              name={playlist.title}
              detail={author}
              label={author === "" ? playlist.title : undefined}
              paths={playlist.artworkUrl === null ? NO_COVERS : [playlist.artworkUrl]}
              size={COVER_ROW_TILE}
              onPress={() =>
                openYtPlaylist(playlist.playlistId, {
                  title: playlist.title,
                  line: author,
                  artworkUrl: playlist.artworkUrl,
                })
              }
            />
          );
        })}
      </CoverRow>
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
  "in-your-orbit": InYourOrbit,
  "from-your-library": FromYourLibrary,
  "community-playlists": CommunityPlaylists,
  "new-releases": NewReleases,
  "upcoming-shows": UpcomingShows,
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
  const hasFollowProvider = useHomeFollowPresence();
  if (!hasFollowProvider && (id === "new-releases" || id === "upcoming-shows"))
    return (
      <HomeFollowProvider>
        <HomeSection id={id} home={home} />
      </HomeFollowProvider>
    );
  if (homeSectionWaiting(id, home)) return <HomeSectionSkeleton id={id} />;
  const Section = SECTIONS[id];
  return <Section home={home} title={homeSectionTitle(id, strings)} />;
}
