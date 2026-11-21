import { IconChevronDown, IconPlus } from "@tabler/icons-react-native";

import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import {
  discoverSongs,
  discoverTrackId,
  followArtistKey,
  relatedPages,
  relatedRowsThatFit,
  relatedWithoutPlaying,
  type QueueContext,
  type YtArtistCandidate,
} from "@wave/core";
import {
  cloneElement,
  useCallback,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { ScrollView, Text, View, type LayoutChangeEvent } from "react-native";

import { ArtistCard } from "@/catalog/cards/ArtistCard";
import { CoverRow } from "@/catalog/CoverRow";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TrackSkeletons } from "@/catalog/Skeletons";
import { IconButton } from "@/components/IconButton";
import { RecommendationsFailed } from "@/components/RecommendationsFailed";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { playListedNow } from "@/playback/actions";
import type { PlaybackState } from "@/playback/Player";
import {
  mixedSongEntry,
  openMixedSongActions,
  runMixedSongSwipe,
  type ListedSong,
} from "@/songs/mixedSongs";
import type { SongRowActions } from "@/songs/SongRow";
import { occurrenceKeys } from "@/songs/songRowState";
import { activeTiming, beginTiming, timingLinkNavigated } from "@/lib/timing";
import { openFollowedArtist } from "@/library/openFollowedArtist";
import { showError } from "@/overlay/alert";
import { useLibraryFinder } from "@/ytmusic/libraryFinder";

import { RELATED_DOTS_HEIGHT, RelatedCarousel } from "./RelatedCarousel";
import { RelatedDragArea } from "./RelatedPanel";
import { useRelatedSongs } from "./relatedSongs";
import type { ScreenPages } from "./ScreenPages";
import { closeNowPlayingForLink, failNowPlayingLink } from "./sheet";
import { TrackHeader } from "./TrackHeader";

const NO_SONGS: readonly NativeYtSong[] = [];
const NO_ARTISTS: readonly YtArtistCandidate[] = [];

/** A similar artist's circle: smaller than a shelf's, so the row fits under the songs. */
const ARTIST_TILE = CELL * 12;

/** Where a related song plays from: Play Now keeps the queue's own context. */
const RELATED: QueueContext = { kind: "related", id: null };

const playNow = (song: ListedSong): void => void playListedNow(song);
/** The + button: the row's own menu's Add to Queue, with its toast, as a swipe elsewhere runs it. */
const addToQueue = (song: ListedSong): void => runMixedSongSwipe(song, "addToQueue");
const titleOf = (song: ListedSong): string =>
  song.source === "library" ? song.track.title : song.song.title;

/** The header's drag area reaches the screen's sides; its arrow lines up with the sheet's chevron. */
const HEADER = { marginHorizontal: -grid.margin, paddingHorizontal: grid.margin } as const;
const ARROW_ROW = { height: CELL * 7, marginLeft: -12 } as const;
/** Under the songs and the artists, so the last of them clears the screen's bottom edge. */
const BOTTOM = CELL * 2;

/**
 * Now Playing's Related screen, inside its panel (`RelatedPanel`): an arrow
 * and the playing song's header (a tap on either, or a drag down on them,
 * returns to the player), then the songs YouTube Music's
 * Related tab gives for it ([videoId]; null for a song without one, undefined
 * while it isn't known; [findAgain] is Try Again's search for a Library song
 * none was found for, `usePlayingVideoId`), without the playing song in any version (Core's
 * `relatedWithoutPlaying`). A song the Library has lists and plays as the Library's. The list sits
 * clear over Now Playing's colours. A tap plays it now and keeps Up Next; rows
 * long-press as anywhere and have no swipe actions. A + on each row's right adds the song to the
 * end of the queue as its menu's Add to Queue does; the row and its + stay, so a second tap adds
 * it again. Offline or on a failure it says "Couldn't load the related songs" with Try Again. Each
 * song's answer is kept for the session.
 *
 * The songs sit in a carousel of full pages (`RelatedCarousel`), sized by Core's `relatedPages`
 * from the rows that fit between the header and the similar artists (`relatedRowsThatFit`), so
 * the artists row under them (left out with none) shows without scrolling. When even 4 rows
 * don't fit with it, pages have 4 and the screen scrolls. Loading shows one page of skeleton rows.
 */
export function RelatedView({
  item,
  videoId,
  findAgain,
  pages,
}: {
  item: NonNullable<PlaybackState["item"]>;
  videoId: string | null | undefined;
  findAgain: () => void;
  pages: ScreenPages;
}) {
  const { strings } = useLocalisation();
  const { send } = pages;
  const arrowBack = useCallback(() => void send({ type: "show", screen: "player" }), [send]);
  const headerTap = useCallback(() => void send({ type: "headerTap" }), [send]);
  const { shown, retry } = useRelatedSongs(videoId, findAgain);
  const find = useLibraryFinder(shown.status === "loaded");
  const answered = shown.status === "loaded" ? shown.answer.songs : NO_SONGS;
  // The playing song in any version (another album's, a live one) isn't related to itself.
  const read = useMemo(
    () =>
      relatedWithoutPlaying(
        item.title === null ? null : { title: item.title, artist: item.artist ?? "" },
        answered,
      ),
    [item.title, item.artist, answered],
  );
  const artists = shown.status === "loaded" ? shown.answer.artists : NO_ARTISTS;
  const songs = useMemo((): readonly ListedSong[] => discoverSongs(read, find), [read, find]);
  const entry = useCallback((song: ListedSong) => mixedSongEntry(song), []);
  // Rows key by song, a second related video of the same Library song by its occurrence.
  const keys = useMemo(() => occurrenceKeys(songs, discoverTrackId), [songs]);
  const keyOf = useCallback((song: ListedSong) => keys.get(song) ?? discoverTrackId(song), [keys]);
  // The space under the header, and how much of it the artists row takes once it is laid out.
  const [space, setSpace] = useState<{ width: number; height: number } | null>(null);
  const [artistsHeight, setArtistsHeight] = useState<number | null>(null);
  const measureSpace = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSpace((was) => (was?.width === width && was.height === height ? was : { width, height }));
  }, []);
  const measureArtists = useCallback(
    (event: LayoutChangeEvent) => setArtistsHeight(event.nativeEvent.layout.height),
    [],
  );
  const under = artists.length === 0 ? 0 : artistsHeight;
  // Null until both are measured: the songs wait a frame for it, so they never change pages.
  const fit =
    space === null || under === null
      ? null
      : relatedRowsThatFit(space.height - under - RELATED_DOTS_HEIGHT - BOTTOM, grid.row);
  const { pageSize, shown: songsShown } = relatedPages(songs.length, fit ?? 0);
  const paged = useMemo(() => songs.slice(0, songsShown), [songs, songsShown]);
  // Each row's +, kept while the songs and the language stay, so the rows aren't drawn again.
  const pluses = useMemo(
    () =>
      new Map(
        songs.map((song): [ListedSong, ReactNode] => [
          song,
          <IconButton
            key="plus"
            icon={IconPlus}
            label={strings.playbackText.addValueToQueue(titleOf(song))}
            onPress={() => addToQueue(song)}
          />,
        ]),
      ),
    [songs, strings],
  );
  const withPlus = useCallback(
    (row: ReactElement, song: ListedSong): ReactNode =>
      cloneElement(row as ReactElement<SongRowActions>, {
        accessory: pluses.get(song),
      }),
    [pluses],
  );
  return (
    <View className="flex-1">
      <RelatedDragArea pages={pages} style={HEADER}>
        <View className="flex-row items-center" style={ARROW_ROW}>
          <IconButton
            icon={IconChevronDown}
            label={strings.playbackText.showPlayer}
            onPress={arrowBack}
          />
        </View>
        <TrackHeader item={item} onShowPlayer={headerTap} />
        <Hairline />
      </RelatedDragArea>
      {shown.status === "failed" ? (
        <RecommendationsFailed
          message={strings.playbackText.couldntLoadTheRelatedSongs}
          onRetry={retry}
          style={{ paddingTop: CELL * 2 }}
        />
      ) : shown.status === "loaded" && songs.length === 0 ? (
        // A song whose watch page has no Related tab: nothing to read again.
        <View>
          <Text
            accessibilityLiveRegion="polite"
            className="font-sans text-subheadline text-secondary"
            style={{ paddingTop: CELL * 2 }}
          >
            {strings.playbackText.couldntLoadTheRelatedSongs}
          </Text>
          {artists.length > 0 && <RelatedArtists artists={artists} />}
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          onLayout={measureSpace}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: BOTTOM }}
        >
          {fit === null || space === null ? null : shown.status === "loading" ? (
            <TrackSkeletons count={fit} />
          ) : (
            <RelatedCarousel
              // A new answer, or a new page size, starts on the first page.
              key={`${keyOf(paged[0]!)}:${pageSize}`}
              pageSize={pageSize}
              width={space.width}
              data={paged}
              keyExtractor={keyOf}
              song={entry}
              context={RELATED}
              onPlay={playNow}
              onMenu={openMixedSongActions}
              decorateRow={withPlus}
            />
          )}
          {artists.length > 0 && (
            <View onLayout={measureArtists}>
              <RelatedArtists artists={artists} />
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Opens the similar artist [artist]'s page as Now Playing's artist line does:
 * the sheet slides away over it, onto the Library's page when the Library
 * has an artist of that name, else their YouTube Music page.
 */
const openRelatedArtist = (artist: YtArtistCandidate): void => {
  beginTiming("artistLink", artist.name);
  closeNowPlayingForLink(() => {
    const timingId = activeTiming()?.id;
    openFollowedArtist({
      key: followArtistKey(artist.name),
      name: artist.name,
      ytBrowseId: artist.browseId,
    }).then(
      () => timingLinkNavigated(timingId),
      (error: unknown) => {
        failNowPlayingLink(timingId);
        showError(currentLocalisation().strings.library.couldntOpenArtist, error);
      },
    );
  });
};

/**
 * The Related tab's similar artists, below the songs' pages: a row that scrolls
 * sideways, each artist's photo over their name. A tap opens their page;
 * TalkBack reads each as a button with the artist's name.
 */
function RelatedArtists({ artists }: { artists: readonly YtArtistCandidate[] }) {
  return (
    <View style={{ paddingTop: CELL * 3 }}>
      <CoverRow>
        {artists.map((artist) => (
          <ArtistCard
            key={artist.browseId}
            name={artist.name}
            artist={{
              name: artist.name,
              thumbPath: null,
              artworkPath: null,
              imageUrl: artist.artworkUrl,
            }}
            size={ARTIST_TILE}
            onPress={() => openRelatedArtist(artist)}
          />
        ))}
      </CoverRow>
    </View>
  );
}
