import { HomeFollowProvider, useHomeFollowPresence } from "./useHomeFollow";
import { useLocalisation } from "@/localisation/localisation";
import { NewReleases } from "./NewReleases";
import { UpcomingShows } from "./UpcomingShows";
import {
  discoverMixCaption,
  discoverMixRowsToBuild,
  discoverRowTitle,
  homeSectionTitle,
  inYourOrbitTileUnavailable,
  MAGIC_QUEUE_PICKS,
  magicQueueCarouselPage,
  magicQueueCarouselPageLabel,
  ytSongArtist,
  ytTrackId,
  type BlendedDiscoverMix,
  type DiscoverMixesSection,
  type HomeSectionId,
  type MagicQueueSeed,
  type YtAlbumSong,
} from "@wave/core";
import { router } from "@/lib/timingRouter";
import { memo, useEffect, useState, type ComponentType, type ReactNode } from "react";
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
import { discoverMixItem, playlistItem, trackItem, ytTrackItem } from "@/playback/mixedItems";
import { MenuChoices } from "@/overlay/MenuChoices";
import { openOverlay } from "@/overlay/overlay";
import { type HomeSelection } from "@/selection/useHomeSelection";

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
} from "./magicQueueSection";
import { useCommunityPlaylists } from "./communityPlaylists";
import { useFromYourLibrary } from "./fromYourLibrary";
import { CarouselPageDots, MagicQueueCarousel } from "./MagicQueueCarousel";
import { useHomeArrangement } from "./homeArrangement";
import { tapInYourOrbit, useInYourOrbit } from "./inYourOrbit";
import { useMostPlayedOfAllTime } from "./mostPlayedOfAllTime";

import { AlbumShelf, ArtistShelf, MostPlayedRows, SongRows } from "./HomeSections";
import { HomeStats } from "./HomeStats";
import { HomeSectionSpace } from "./HomeSectionSpace";
import { noteCarouselPage, snapshotCarouselPage } from "./homeSnapshot";
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
  /** One checked set shared by every Home section. */
  selection: HomeSelection;
};

function MostPlayedAlbums({ title, selection }: SectionProps) {
  const { strings } = useLocalisation();
  const ranking = useMostPlayedOfAllTime();
  if (ranking === undefined) return <HomeSectionSpace id="most-played-albums" />;
  const albums = withPlays(ranking.albums);
  if (albums.length === 0) return null;
  return (
    <TitledSection
      title={title}
      action={{ label: strings.home.seeAll, onPress: () => openStatsSeeAll("albums", "all") }}
      selecting={selection.selecting}
    >
      <AlbumShelf
        albums={albums}
        detail={(album) => strings.stats.plays(album.countedPlays)}
        selection={selection}
      />
    </TitledSection>
  );
}

/**
 * Home's Discover section: one header, its adjustments icon opening the
 * settings card all three rows share (`DiscoverSettingsButton`), the DJ card
 * while YT Music is on, then the rows in the owner's order, each under its label. A row with nothing to show isn't drawn: a mix row shows placeholder tiles
 * while its first mixes build and is gone with YT Music off (Core's
 * `discoverMixesSection`), the Magic Queue row is gone while it has nothing
 * to show (Core's `magicQueueRow`: before its pages are first read, or with
 * an empty pool and no chart mix to take songs from). The section
 * is gone when every arranged row is gone and YT Music is off, which hides
 * the DJ card.
 */
function Discover({ home, title, selection }: SectionProps) {
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
  const rows = discoverRows.filter((id) =>
    id === "magic-queue"
      ? magicQueue.shown.kind !== "hidden"
      : (id === "artist-mixes" ? artistMixes : genreMixes).kind !== "hidden",
  );
  if (rows.length === 0 && !ytMusic) return null;
  return (
    <TitledSection
      title={title}
      control={<DiscoverSettingsButton ytMusic={ytMusic} />}
      selecting={selection.selecting}
    >
      <View style={{ gap: CELL * 3 }}>
        {ytMusic && <DjCard />}
        {rows.map((id) =>
          id === "magic-queue" ? (
            <MagicQueueRow key={id} section={magicQueue} selection={selection} />
          ) : (
            <MixRow
              key={id}
              id={id}
              section={id === "artist-mixes" ? artistMixes : genreMixes}
              selection={selection}
            />
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
function MixRow({
  id,
  section,
  selection,
}: {
  id: MixSectionId;
  section: DiscoverMixesSection;
  selection: HomeSelection;
}) {
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
      refresh={
        selection.selecting
          ? undefined
          : { label: strings.discover.refresh[id], run: refresh, enabled: !updating }
      }
    >
      {section.kind === "skeleton" ? (
        <DiscoverMixesSkeleton />
      ) : section.kind === "mixes" ? (
        <DiscoverMixRow
          mixes={section.mixes}
          onRefresh={refresh}
          refreshing={section.updating}
          selection={selection}
        />
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
  selection,
}: {
  mixes: readonly BlendedDiscoverMix[];
  onRefresh: () => void;
  refreshing: boolean;
  selection: HomeSelection;
}) {
  const { strings } = useLocalisation();
  return (
    <PullRefreshRow onRefresh={onRefresh} enabled={!refreshing && !selection.selecting}>
      {mixes.map((mix, place) => {
        const caption = discoverMixCaption(mix, strings);
        const shows = [mix.id, caption.artworkUrl, caption.title, caption.artists, caption.line];
        const item = selection.remember(discoverMixItem(mix));
        return (
          // oxlint-disable-next-line react/no-array-index-key -- a place crossfades from the mix it had to the one it has now
          <Crossfade key={place} swapKey={shows.join("\n")}>
            <PlaylistCard
              name={caption.title}
              label={[caption.title, caption.artists, caption.line].filter(Boolean).join(", ")}
              detail={caption.line}
              paths={caption.artworkUrl === null ? [] : [caption.artworkUrl]}
              size={COVER_ROW_TILE}
              checked={selection.selecting ? selection.isChecked(item) : undefined}
              onPress={() =>
                selection.selecting ? selection.toggle(item) : openDiscoverMix(mix.id)
              }
              onLongPress={
                selection.selecting || !selection.enabled
                  ? undefined
                  : () =>
                      openDiscoverMixActions(mix, {
                        onSelect: selection.enabled ? () => selection.start(item) : undefined,
                      })
              }
            />
          </Crossfade>
        );
      })}
    </PullRefreshRow>
  );
}

/**
 * The page the carousel last showed, kept while the app runs: coming back to
 * Home finds it there. A cold start opens on the snapshot's (#1353).
 */
let keptPage: number | null = snapshotCarouselPage();

/**
 * As tall as the refresh button, so the label line keeps its height; with
 * its hit slop the button takes a 48dp touch.
 */
const CAROUSEL_CONTROLS = CELL * 4;

/** A page's songs as the tiles of its grid, each under the key its place crossfades by. */
const seedTiles = (
  seeds: readonly MagicQueueSeed<PlayableSongRow>[],
  size: number,
  selection: HomeSelection,
) =>
  seeds.map((seed) =>
    seed.source === "library"
      ? {
          key: String(seed.song.id),
          tile: <LibraryTile song={seed.song} size={size} selection={selection} />,
        }
      : {
          key: ytTrackId(seed.song.videoId),
          tile: <StreamedTile song={seed.song} size={size} selection={selection} />,
        },
  );

/** A tile of the row, under the key its place crossfades by. */
type RowTile = { readonly key: string; readonly tile: ReactNode };

/**
 * A page of the Magic Queue row in its grid, [width] wide: the pool's
 * [seeds], or the mixes' [songs] (an empty pool), or placeholder tiles while
 * [skeleton]. With [onRefresh] (one page, nothing to swipe), a pull past its
 * start refreshes it. Memoized: a swipe changes the dots and the page in
 * sight, not the pages' songs, so their tiles aren't drawn again (#1380).
 */
const MagicQueuePage = memo(function MagicQueuePage({
  seeds,
  songs,
  skeleton,
  size,
  width,
  onRefresh,
  selection,
}: {
  seeds?: readonly MagicQueueSeed<PlayableSongRow>[] | undefined;
  songs?: readonly YtAlbumSong[] | undefined;
  skeleton: boolean;
  size: number;
  width: number;
  onRefresh?: (() => void) | undefined;
  selection: HomeSelection;
}) {
  const { strings } = useLocalisation();
  const { fontScale } = useWindowDimensions();
  if (skeleton)
    return (
      <SkeletonGroup label={strings.discover.findingSongs}>
        <MagicQueueGrid width={width}>
          {Array.from({ length: MAGIC_QUEUE_PICKS }, (_, place) => (
            <SongCardSkeleton key={place} size={size} fontScale={fontScale} />
          ))}
        </MagicQueueGrid>
      </SkeletonGroup>
    );
  const tiles: readonly RowTile[] =
    seeds !== undefined
      ? seedTiles(seeds, size, selection)
      : (songs ?? []).map((song) => ({
          key: song.videoId,
          tile: <StreamedTile song={song} size={size} selection={selection} />,
        }));
  const drawn = (
    <MagicQueueGrid width={width}>
      {tiles.map(({ key, tile }, place) => (
        // oxlint-disable-next-line react/no-array-index-key -- a place crossfades between its previous and next song
        <Crossfade key={place} swapKey={key}>
          {tile}
        </Crossfade>
      ))}
    </MagicQueueGrid>
  );
  return onRefresh === undefined ? (
    drawn
  ) : (
    <PullRefreshRow onRefresh={onRefresh} enabled={!selection.selecting}>
      {drawn}
    </PullRefreshRow>
  );
});

/**
 * Discover's Magic Queue row, labelled Magic Queue: a carousel of up to three
 * pages swiped sideways (Core's `magicQueuePages`), each up to nine songs in
 * an adaptive grid, all drawn by one rule, so no page has a name. A tap on a
 * song starts a Magic Queue from it, its long-press opens the song's menu.
 * Dots beside the label show where the page in sight sits; TalkBack hears
 * the page's place as it changes and moves between pages by adjusting the
 * dots. The refresh icon beside them draws only the page in sight again,
 * with a "New songs" toast and Undo. The row comes back on the page it was
 * left on. With one page there are no dots and nothing to swipe, and a pull
 * past its start refreshes it too.
 *
 * With an empty pool the row is one page of the Artist mixes' streamed
 * songs, with placeholder tiles while the first mixes build. Each place
 * crossfades its tile when its song changes. Hidden with YT Music off.
 */
function MagicQueueRow({
  section,
  selection,
}: {
  section: MagicQueueSection;
  selection: HomeSelection;
}) {
  const { strings } = useLocalisation();
  const { width, fontScale } = useWindowDimensions();
  const [available, setAvailable] = useState(width - grid.margin * 2);
  const [kept, setKept] = useState(keptPage);
  useEffect(() => {
    if (kept === null) return;
    keptPage = kept;
    noteCarouselPage(kept);
  }, [kept]);
  const { size } = magicQueueGrid(available, fontScale);
  const { shown } = section;
  const skeleton = shown.kind === "skeleton";
  const count =
    shown.kind === "pages" ? shown.pages.length : shown.kind === "mixes" || skeleton ? 1 : 0;
  if (count === 0) return null;
  const index = magicQueueCarouselPage(count, kept);
  const paged = count > 1;
  const show = (next: number) => {
    if (next < 0 || next >= count) return;
    setKept(next);
    AccessibilityInfo.announceForAccessibility(magicQueueCarouselPageLabel(next, count, strings));
  };
  const refresh = () => section.refresh(index);
  // The page's songs keep their arrays across a swipe, so its memoized grid isn't drawn again.
  const page = (place: number, onRefresh?: () => void) => (
    <MagicQueuePage
      seeds={shown.kind === "pages" ? shown.pages[place] : undefined}
      songs={shown.kind === "mixes" ? shown.songs : undefined}
      skeleton={skeleton}
      size={size}
      width={available}
      onRefresh={onRefresh}
      selection={selection}
    />
  );
  return (
    <DiscoverRow
      label={strings.discover.rows["magic-queue"]}
      busy={skeleton}
      refresh={
        selection.selecting
          ? undefined
          : { label: strings.discover.otherSongs, run: refresh, enabled: !skeleton }
      }
      trailing={
        <View className="flex-row items-center" style={{ gap: CELL, minHeight: CAROUSEL_CONTROLS }}>
          {!skeleton && !selection.selecting && (
            <IconButton
              icon={IconRefresh}
              label={strings.discover.otherSongs}
              size={CAROUSEL_CONTROLS}
              iconSize={CELL * 2.5}
              tone="secondary"
              hitSlop={CELL}
              onPress={refresh}
            />
          )}
          {paged && (
            <CarouselPageDots
              count={count}
              index={index}
              label={magicQueueCarouselPageLabel(index, count, strings)}
              onIndex={show}
            />
          )}
        </View>
      }
    >
      <View onLayout={(event) => setAvailable(event.nativeEvent.layout.width)}>
        {paged ? (
          <MagicQueueCarousel
            pages={Array.from({ length: count }, (_, place) => ({
              key: `page-${place}`,
              content: page(place),
            }))}
            index={index}
            onIndex={show}
            width={available}
          />
        ) : (
          page(0, skeleton ? undefined : refresh)
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
function LibraryTile({
  song,
  size,
  selection,
}: {
  song: PlayableSongRow;
  size: number;
  selection: HomeSelection;
}) {
  const { strings } = useLocalisation();
  const item = selection.remember(trackItem(song));
  return (
    <SongCard
      title={song.title}
      artist={song.artist}
      artworkUri={artworkUri(song, "medium")}
      size={size}
      label={strings.discover.startMagicQueue(song.title, song.artist, song.album)}
      checked={selection.selecting ? selection.isChecked(item) : undefined}
      onPress={() => (selection.selecting ? selection.toggle(item) : startMagicQueueFrom(song))}
      onLongPress={
        selection.selecting
          ? undefined
          : () =>
              openTrackActions(song, {
                onSelect: selection.enabled ? () => selection.start(item) : undefined,
              })
      }
    />
  );
}

/** A streamed song (a mix's or a playlist's) as a song card; a tap starts the Magic Queue from its radio. */
function StreamedTile({
  song,
  size,
  selection,
}: {
  song: YtAlbumSong;
  size: number;
  selection: HomeSelection;
}) {
  const { strings } = useLocalisation();
  const artist = ytSongArtist(song);
  const item = selection.remember(ytTrackItem(song as import("@/native/waveYtMusic").NativeYtSong));
  return (
    <SongCard
      title={song.title}
      artist={artist}
      artworkUri={song.artworkUrl ?? undefined}
      size={size}
      label={strings.discover.startMagicQueue(song.title, artist, song.album)}
      checked={selection.selecting ? selection.isChecked(item) : undefined}
      onPress={() =>
        selection.selecting ? selection.toggle(item) : startStreamedMagicQueueFrom(song)
      }
      onLongPress={
        selection.selecting
          ? undefined
          : () =>
              openYtSongActions(song, {
                onSelect: selection.enabled ? () => selection.start(item) : undefined,
              })
      }
    />
  );
}

function Favorites({ home, title, selection }: SectionProps) {
  const { strings } = useLocalisation();
  if (home.favorites === undefined || home.favorites.length === 0) return null;
  return (
    <TitledSection
      title={title}
      action={{ label: strings.home.seeAll, onPress: () => router.push("/library/favorites") }}
      selecting={selection.selecting}
    >
      <SongRows songs={home.favorites} context={FAVORITES_CONTEXT} selection={selection} />
    </TitledSection>
  );
}

function MostPlayedArtists({ title, selection }: SectionProps) {
  const { strings } = useLocalisation();
  const ranking = useMostPlayedOfAllTime();
  if (ranking === undefined) return <HomeSectionSpace id="most-played-artists" />;
  const artists = ranking.artists.map((entry) => entry.item);
  if (artists.length === 0) return null;
  return (
    <TitledSection
      title={title}
      action={{ label: strings.home.seeAll, onPress: () => openStatsSeeAll("artists", "all") }}
      selecting={selection.selecting}
    >
      <ArtistShelf artists={artists} selecting={selection.selecting} />
    </TitledSection>
  );
}

/**
 * One of In your orbit's songs as a song card: a tap starts a Magic Queue
 * from it, or with YT Music off plays the grid's Library songs from it
 * (`tapInYourOrbit`); a streamed song shows unavailable then. A long press
 * opens its menu.
 */
function OrbitTile({
  seed,
  size,
  ytMusic,
  onPress,
  selection,
}: {
  seed: MagicQueueSeed<PlayableSongRow>;
  size: number;
  ytMusic: boolean;
  onPress: () => void;
  selection: HomeSelection;
}) {
  const { strings } = useLocalisation();
  const { title, album } = seed.song;
  const artist = seed.source === "library" ? seed.song.artist : ytSongArtist(seed.song);
  const item = selection.remember(
    seed.source === "library"
      ? trackItem(seed.song)
      : ytTrackItem(seed.song as import("@/native/waveYtMusic").NativeYtSong),
  );
  return (
    <SongCard
      title={title}
      artist={artist}
      artworkUri={
        seed.source === "library"
          ? artworkUri(seed.song, "medium")
          : ytMusic
            ? (seed.song.artworkUrl ?? undefined)
            : undefined
      }
      size={size}
      label={ytMusic ? strings.discover.startMagicQueue(title, artist, album) : undefined}
      unavailable={inYourOrbitTileUnavailable(seed, ytMusic)}
      checked={selection.selecting ? selection.isChecked(item) : undefined}
      onPress={() => (selection.selecting ? selection.toggle(item) : onPress())}
      onLongPress={
        selection.selecting
          ? undefined
          : () =>
              seed.source === "library"
                ? openTrackActions(seed.song, {
                    onSelect: selection.enabled ? () => selection.start(item) : undefined,
                  })
                : openYtSongActions(seed.song, {
                    onSelect: selection.enabled ? () => selection.start(item) : undefined,
                  })
      }
    />
  );
}

/** Home's nine most played recent songs as a grid laid out as the Magic Queue's is. */
function InYourOrbit({ title, selection }: SectionProps) {
  const songs = useInYourOrbit();
  const ytMusic = useYtMusicEnabled();
  const { width, fontScale } = useWindowDimensions();
  const [available, setAvailable] = useState(width - grid.margin * 2);
  if (songs === undefined) return <HomeSectionSpace id="in-your-orbit" />;
  if (songs.length === 0) return null;
  const { size } = magicQueueGrid(available, fontScale);
  return (
    <TitledSection title={title} selecting={selection.selecting}>
      <View onLayout={(event) => setAvailable(event.nativeEvent.layout.width)}>
        <MagicQueueGrid width={available}>
          {songs.map((seed, index) => {
            const key =
              seed.source === "library" ? String(seed.song.id) : ytTrackId(seed.song.videoId);
            return (
              <Crossfade key={key} swapKey={key}>
                <OrbitTile
                  seed={seed}
                  size={size}
                  ytMusic={ytMusic}
                  onPress={() => tapInYourOrbit(songs, index)}
                  selection={selection}
                />
              </Crossfade>
            );
          })}
        </MagicQueueGrid>
      </View>
    </TitledSection>
  );
}

/**
 * From your library: the owner's most played playlists as cards in one row,
 * those played in the last 14 days first (Core's `fromYourLibrary`). A tap
 * opens the playlist, a long press its menu.
 */
function FromYourLibrary({ title, selection }: SectionProps) {
  const { strings } = useLocalisation();
  const playlists = useFromYourLibrary();
  if (playlists === undefined) return <HomeSectionSpace id="from-your-library" />;
  if (playlists.length === 0) return null;
  return (
    <TitledSection title={title} selecting={selection.selecting}>
      <CoverRow>
        {playlists.map((playlist) =>
          (() => {
            const item = selection.remember(playlistItem(playlist));
            return (
              <PlaylistCard
                key={playlist.id}
                name={playlist.name}
                detail={songCount(playlist.trackCount, strings)}
                paths={playlist.thumbPaths}
                size={COVER_ROW_TILE}
                checked={selection.selecting ? selection.isChecked(item) : undefined}
                onPress={() =>
                  selection.selecting ? selection.toggle(item) : openPlaylist(playlist.id, playlist)
                }
                onLongPress={
                  selection.selecting
                    ? undefined
                    : () =>
                        openPlaylistActions(playlist, {
                          onSelect: selection.enabled ? () => selection.start(item) : undefined,
                        })
                }
              />
            );
          })(),
        )}
      </CoverRow>
    </TitledSection>
  );
}

/** A community playlist YouTube Music lists no cover for. */
const NO_COVERS: readonly string[] = [];

const openHomePlaylistSelectMenu = (
  title: string,
  selectLabel: string,
  onSelect: () => void,
): void => {
  openOverlay({
    label: title,
    render: (close) => (
      <MenuChoices
        cards={[]}
        entries={[
          {
            action: "select",
            label: selectLabel,
            onPress: () => {
              close();
              onSelect();
            },
          },
        ]}
      />
    ),
  });
};

/**
 * Community playlists: the playlists of the shelves YouTube Music shows on
 * the connected account's home, as playlist cards in one row (Core's
 * `homeCommunityPlaylistsShown`), each with its author under its title. A tap
 * opens the playlist's page. Left out signed out and with nothing kept; the
 * kept list shows at once, so there is no skeleton.
 */
function CommunityPlaylists({ title, selection }: SectionProps) {
  const { strings } = useLocalisation();
  const playlists = useCommunityPlaylists();
  if (playlists.length === 0) return null;
  return (
    <TitledSection title={title} selecting={selection.selecting}>
      <CoverRow>
        {playlists.map((playlist) => {
          const author = playlist.author ?? "";
          const item = selection.remember({
            kind: "ytPlaylist",
            item: {
              playlistId: playlist.playlistId,
              title: playlist.title,
              author,
              artworkUrl: playlist.artworkUrl,
            },
          });
          return (
            <PlaylistCard
              key={playlist.playlistId}
              name={playlist.title}
              detail={author}
              label={author === "" ? playlist.title : undefined}
              paths={playlist.artworkUrl === null ? NO_COVERS : [playlist.artworkUrl]}
              size={COVER_ROW_TILE}
              checked={selection.selecting ? selection.isChecked(item) : undefined}
              onPress={() =>
                selection.selecting
                  ? selection.toggle(item)
                  : openYtPlaylist(playlist.playlistId, {
                      title: playlist.title,
                      line: author,
                      artworkUrl: playlist.artworkUrl,
                    })
              }
              onLongPress={
                selection.selecting
                  ? undefined
                  : () =>
                      openHomePlaylistSelectMenu(
                        playlist.title,
                        strings.itemActions.labels.select,
                        () => selection.start(item),
                      )
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
  "recently-added": ({ home, title, selection }) =>
    home.recentlyAdded !== undefined &&
    home.recentlyAdded.length > 0 && (
      <TitledSection title={title} selecting={selection.selecting}>
        <AlbumShelf albums={home.recentlyAdded} selection={selection} />
      </TitledSection>
    ),
  "recently-played": ({ home, title, selection }) =>
    home.recentlyPlayed !== undefined &&
    home.recentlyPlayed.length > 0 && (
      <TitledSection title={title} selecting={selection.selecting}>
        <AlbumShelf albums={home.recentlyPlayed} selection={selection} />
      </TitledSection>
    ),
  "most-played": ({ home, title, selection }) =>
    home.mostPlayed !== undefined &&
    home.mostPlayed.length > 0 && (
      <TitledSection title={title} selecting={selection.selecting}>
        <MostPlayedRows
          rows={home.mostPlayed}
          context={MOST_PLAYED_CONTEXT}
          selection={selection}
        />
      </TitledSection>
    ),
  "most-played-albums": MostPlayedAlbums,
  "most-played-artists": MostPlayedArtists,
  favorites: Favorites,
  stats: HomeStats,
};

/** Space above every section but the first on a screen: what `TitledSection` puts there. */
export const SECTION_GAP = CELL * 5;

const INERT_HOME_SELECTION: HomeSelection = {
  enabled: false,
  selecting: false,
  selection: null,
  isChecked: () => false,
  start: () => undefined,
  toggle: () => undefined,
  end: () => undefined,
  remember: (item) => item,
};

/**
 * The section [id] of Home's catalogue with its data, or nothing when it has
 * nothing to show. Every section leaves `SECTION_GAP` above itself, so it can
 * sit under any screen's content (Home, or the Library under its rows).
 * [home] is `useHome`'s answer.
 */
export function HomeSection({
  id,
  home,
  selection = INERT_HOME_SELECTION,
}: {
  id: HomeSectionId;
  home: HomeContent;
  selection?: HomeSelection;
}) {
  const { strings } = useLocalisation();
  const hasFollowProvider = useHomeFollowPresence();
  if (!hasFollowProvider && (id === "new-releases" || id === "upcoming-shows"))
    return (
      <HomeFollowProvider>
        <HomeSection id={id} home={home} selection={selection} />
      </HomeFollowProvider>
    );
  if (homeSectionWaiting(id, home)) return <HomeSectionSpace id={id} />;
  const Section = SECTIONS[id];
  return <Section home={home} title={homeSectionTitle(id, strings)} selection={selection} />;
}
