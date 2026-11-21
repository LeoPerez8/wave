import { useLocalisation } from "@/localisation/localisation";
import { activeTiming, beginTiming, timingSurfaceCommitted } from "@/lib/timing";
import { IconChevronDown, IconDotsVertical, IconListNumbers } from "@tabler/icons-react-native";
import {
  isUnsearchedTrackId,
  nowPlayingSlotShow,
  nowPlayingSongMenuShow,
  type NowPlayingSlotSong,
} from "@wave/core";
import type { ReactNode } from "react";
import {
  Activity,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CELL, grid } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import { NativeCover } from "@/glass/waveGlass";
import { CoveredByNowPlaying } from "@/lib/screenSight";
import { addScreenBackHandler } from "@/overlay/back";
import { useRenderCount } from "@/perf/perf";
import type { TrackDetails } from "@wave/client";
import { openPlayingActions } from "@/playback/ActionsMenu";
import { useCurrentTrackId } from "@/playback/hooks";
import { playbackState, type PlaybackState } from "@/playback/Player";
import { LyricCardLayer } from "@/share/LyricCardLayer";
import { useLyricCardShown } from "@/share/lyricCard";
import { useSongShareShown } from "@/share/songShare";
import { shareNowPlaying } from "@/share/songShare";
import { useNowPlayingButtons } from "@/settings/nowPlayingButtons";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { Background, useBackgroundColors, type GroundColors } from "./Background";
import { DismissArea } from "./DismissArea";
import {
  useDownloadedFile,
  type LibraryFile,
  useNowPlayingGradient,
  useNowPlayingPalette,
  usePlayingYtSong,
  useTrackDetails,
} from "./hooks";
import { LyricsView } from "./LyricsView";
import { PlayerView } from "./PlayerView";
import { QueueHeader, UpNextList } from "./QueueView";
import { usePlayingVideoId } from "./relatedSongs";
import { RelatedPanel } from "./RelatedPanel";
import { RelatedView } from "./RelatedView";
import { QueueEdgeMark, ScreenPage, useScreenPages } from "./ScreenPages";
import { Scrubber } from "./Scrubber";
import { usePlayheadSource } from "./playhead";
import {
  closeNowPlaying,
  nowPlayingContentCommitted,
  onNowPlayingHidden,
  resizeNowPlaying,
  sheetOffset,
  useNowPlayingShown,
  useNowPlayingSettled,
} from "./sheet";
import { onRelatedOpened } from "./openRelated";
import { SlotButton, ViewToggle, type SlotContext } from "./SlotButtons";
import { Transport } from "./Transport";
import {
  nowPlayingSongLookup,
  songActionFailed,
  usePlayingSongTarget,
  usePreparePlayingSong,
} from "./playingSong";

/** What fills the player's space above the controls. The Queue and Related are screens of their own. */
export type NowPlayingView = "player" | "lyrics";

const close = (): void => closeNowPlaying(undefined, "chevron");

type Item = NonNullable<PlaybackState["item"]>;

/**
 * The Queue screen: what's playing in the drag-to-dismiss area, then the
 * list, at the page's full height. Once shown it stays mounted, hidden
 * (`Activity`) while the player shows and while Now Playing is closed: coming back
 * shows its rows as they were, re-rendering only what changed meanwhile.
 * Hidden, it follows nothing (its store subscriptions, gestures and frame
 * callbacks are effects, which `Activity` tears down) and holds only the
 * rows Legend List had drawn; each showing places Up Next again through the
 * list (`UpNextList`), so the rows show at once even if the queue changed out
 * of sight. Memoized, so the sheet's renders (the playing state) don't reach
 * it while it's hidden.
 */
const QueuePane = memo(function QueuePane({
  item,
  ground,
  top,
  onShowPlayer,
}: {
  item: Item;
  ground: GroundColors;
  /** Where the page sits on the sheet: the list's sticky bar draws the ground there. */
  top: number;
  onShowPlayer: () => void;
}) {
  return (
    <View className="flex-1">
      <DismissArea>
        <QueueHeader item={item} onShowPlayer={onShowPlayer} />
      </DismissArea>
      <UpNextList bottomInset={CELL * 2} ground={ground} paneTop={top} />
    </View>
  );
});

const PLAYER_AREA = { flex: 1, paddingTop: CELL } as const;

/**
 * The player view. It stays mounted, hidden (`Activity`) while the Queue or
 * Lyrics shows or Related covers it, so coming back to it draws the artwork straight away; hidden,
 * it follows nothing (links, the route, the star). While Now Playing is
 * closed it shows (out of sight) and follows the playing track, so an open's
 * first frame is right.
 */
const PlayerPane = memo(function PlayerPane({
  item,
  details,
  playing,
}: {
  item: Item;
  details: TrackDetails | null;
  playing: boolean;
}) {
  return (
    <DismissArea style={PLAYER_AREA}>
      <PlayerView item={item} details={details} playing={playing} />
    </DismissArea>
  );
});

/** `nativeID` of the screens under Now Playing, which the sheet's cover hides (`NativeCover`). */
const UNDER_NOW_PLAYING = "wave-under-now-playing";

/**
 * Wraps the screens under Now Playing: screen readers skip them while it is
 * up, and their shared Library queries pause (`CoveredByNowPlaying`). Once the
 * sheet settles open over them they aren't drawn, glass included, until it
 * moves again (`NativeCover`).
 */
export function UnderNowPlaying({ children }: { children: ReactNode }) {
  const shown = useNowPlayingShown();
  const sharing = useSongShareShown();
  return (
    <View
      nativeID={UNDER_NOW_PLAYING}
      collapsable={false}
      style={{ flex: 1 }}
      importantForAccessibility={shown || sharing ? "no-hide-descendants" : "auto"}
    >
      <CoveredByNowPlaying.Provider value>{children}</CoveredByNowPlaying.Provider>
    </View>
  );
}

/**
 * Now Playing: a sheet over the app, tinted by the artwork. The player view
 * (artwork, title, artist and album) or the Lyrics view sits above the
 * scrubber and transport; the Queue is a screen of its own, a swipe to the
 * right of them (`ScreenPages`), and Related a panel that rises over all of
 * it (`RelatedPanel`). Drag it down or tap the chevron to dismiss it; Back
 * leaves the Queue or Related first.
 *
 * It stays mounted out of sight below the screen, following the playing track
 * (its colours, artwork and links) while closed, so opening it only starts the
 * spring and its first frame is already right.
 */
export function NowPlayingSheet() {
  const { strings } = useLocalisation();
  useRenderCount("NowPlayingSheet");
  usePlayheadSource();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const shown = useNowPlayingShown();
  const songSharing = useSongShareShown();
  const lyricSharing = useLyricCardShown();
  const item = useSyncExternalStore(playbackState.subscribe, () => playbackState.get().item);
  const playing = useSyncExternalStore(
    playbackState.subscribe,
    () => playbackState.get().playWhenReady,
  );
  const trackId = useCurrentTrackId();
  const details = useTrackDetails(trackId);
  const ytSong = usePlayingYtSong(trackId);
  const songTarget = usePlayingSongTarget(trackId, ytSong);
  const settled = useNowPlayingSettled();
  usePreparePlayingSong(songTarget, shown, settled);
  const palette = useNowPlayingPalette(trackId, details);
  const gradient = useNowPlayingGradient(palette);
  const ground = useBackgroundColors(gradient, shown);
  const [view, setView] = useState<NowPlayingView>("player");
  const ytMusic = useYtMusicEnabled();
  const showPlayer = useCallback(() => setView("player"), []);
  // The player and the Queue, side by side; the Queue stays mounted once shown (`QueuePane`).
  // Related rises over them.
  const pages = useScreenPages();
  const { screen, page, turning, send } = pages;
  // Settled, Related covers the pages: what is under it rests until it moves.
  const covered = screen === "related" && !pages.relatedMoving;
  // Related stays drawn, with its songs, while its panel leaves.
  const relatedMounted = screen === "related" || pages.relatedMoving;
  const { videoId, findAgain } = usePlayingVideoId(relatedMounted ? trackId : null, ytSong);
  const leaveQueue = useCallback(() => void send({ type: "headerTap" }), [send]);
  // Where the pages sit on the sheet, for the Queue's sticky bar.
  const [pagesTop, setPagesTop] = useState(0);
  useLayoutEffect(() => {
    if (shown) nowPlayingContentCommitted();
  }, [shown]);
  useLayoutEffect(() => {
    if (screen !== "queue") return;
    const active = activeTiming();
    if (active?.kind === "queue") timingSurfaceCommitted(active.id);
  }, [screen]);
  // A streamed song downloaded since it was queued: Lyrics reads its file, as for a Library song.
  const downloaded = useDownloadedFile(ytSong);
  const lyricsFile: LibraryFile | null =
    details === null ? (downloaded ?? null) : { id: details.id, path: details.path };
  // A non-D song's search waits until the Library is read: a song with a file reads it instead.
  const nonDTrackId = lyricsFile === null && downloaded !== undefined ? trackId : null;

  useEffect(() => resizeNowPlaying(height), [height]);

  // Every open starts on the player, unless the playing song's card asked for Related.
  useEffect(
    () =>
      onNowPlayingHidden(() => {
        setView("player");
        send({ type: "closed" });
      }),
    [send],
  );
  // The chevron, the playing song's card and the mini player's card ask for Related.
  useEffect(() => onRelatedOpened(() => void send({ type: "show", screen: "related" })), [send]);
  // Related needs YouTube Music: turned off, the player comes back.
  useEffect(() => {
    if (!ytMusic && screen === "related") send({ type: "ytMusicOff" });
  }, [ytMusic, screen, send]);
  // The Queue is the playing song's: with nothing playing, the player shows.
  const nothingPlaying = item === null;
  useEffect(() => {
    if (nothingPlaying) send({ type: "show", screen: "player" });
  }, [nothingPlaying, send]);

  // Back leaves the Queue or Related; on the player it slides the sheet away instead of
  // leaving the screen under it (Core's `stepNowPlayingScreens`).
  useEffect(() => {
    if (!shown) return undefined;
    return addScreenBackHandler(() => {
      if (send({ type: "back" })) closeNowPlaying(undefined, "Back");
      return true;
    });
  }, [shown, send]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetOffset.get() }],
  }));

  // The row's button and the edge mark open the Queue screen.
  const openQueue = () => {
    if (item === null) return;
    if (screen !== "queue") beginTiming("queue", "Queue");
    send({ type: "show", screen: "queue" });
  };
  const toggleLyrics = () => {
    if (view !== "lyrics" && songTarget !== null)
      void nowPlayingSongLookup.acquire(songTarget).catch(songActionFailed);
    setView((current) => (current === "lyrics" ? "player" : "lyrics"));
  };
  const share = () => {
    if (item === null) return;
    shareNowPlaying(
      {
        title: item.title ?? strings.playbackText.unknownTitle,
        artist: item.artist ?? strings.playbackText.unknownArtist,
        artworkUri: item.artworkUri ?? undefined,
        palette,
      },
      trackId,
      ytSong,
    );
  };
  const slotContext: SlotContext = {
    trackId,
    ytSong,
    title: item?.title ?? strings.playbackText.unknownTitle,
    lyricsShown: view === "lyrics",
    toggleLyrics,
    share,
  };
  const slotSong: NowPlayingSlotSong =
    item === null
      ? "nothing"
      : trackId !== null && isUnsearchedTrackId(trackId)
        ? "unsearched"
        : "song";
  // The slots that aren't None and show for what's on, spread evenly left of Queue.
  const slots = useNowPlayingButtons().flatMap((action, slot) => {
    if (action === null) return [];
    return nowPlayingSlotShow(action, slotSong) === "hidden" ? [] : [{ action, slot }];
  });
  const songMenu = nowPlayingSongMenuShow(slotSong);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, sheetStyle]}
      // Out of sight, it takes no touches and screen readers skip it.
      pointerEvents={shown ? "auto" : "none"}
      importantForAccessibility={shown && !songSharing ? "auto" : "no-hide-descendants"}
      accessibilityElementsHidden={!shown || songSharing}
    >
      <Background colors={ground} />
      {/* Opaque and settled over the screens under it, the sheet stops their drawing (#721). */}
      <NativeCover
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        coveredNativeId={UNDER_NOW_PLAYING}
        settled={settled}
      />
      <View
        className="flex-1"
        importantForAccessibility={
          lyricSharing || screen === "related" ? "no-hide-descendants" : "auto"
        }
        accessibilityElementsHidden={screen === "related"}
        style={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + CELL * 2,
          paddingHorizontal: grid.margin,
        }}
      >
        <DismissArea
          style={{ marginHorizontal: -grid.margin, paddingHorizontal: grid.margin - 12 }}
        >
          <View className="flex-row items-center justify-between" style={{ height: CELL * 7 }}>
            <IconButton
              icon={IconChevronDown}
              label={strings.playbackText.closeNowPlaying}
              onPress={close}
            />
            {/* The playing song's card, anchored here; off while an unsearched entry's search runs. */}
            {songMenu !== "hidden" && (
              <IconButton
                icon={IconDotsVertical}
                label={strings.playbackText.songMenu}
                disabled={songMenu === "off"}
                opensMenu
                onPress={openPlayingActions}
              />
            )}
          </View>
        </DismissArea>

        <View className="flex-1" onLayout={(event) => setPagesTop(event.nativeEvent.layout.y)}>
          {item !== null && pages.queueMounted && (
            <ScreenPage screen="queue" pages={pages}>
              <Activity
                mode={(page === "queue" || turning) && !covered ? "visible" : "hidden"}
                name={strings.playbackText.queue}
              >
                <QueuePane item={item} ground={ground} top={pagesTop} onShowPlayer={leaveQueue} />
              </Activity>
            </ScreenPage>
          )}
          {/* The player's page: a swipe to the left anywhere but the scrubber brings the Queue. */}
          <ScreenPage screen="player" pages={pages} swipes={item !== null}>
            {item === null ? (
              <DismissArea style={{ flex: 1 }}>
                <View className="flex-1 items-center justify-center">
                  <Text className="font-sans text-subheadline text-secondary">
                    {strings.playbackText.nothingIsPlaying}
                  </Text>
                </View>
              </DismissArea>
            ) : (
              <>
                {view === "lyrics" && (
                  <LyricsView
                    file={lyricsFile}
                    nonDTrackId={nonDTrackId}
                    item={item}
                    palette={palette}
                    gradient={gradient}
                    onShowPlayer={showPlayer}
                  />
                )}
                <Activity
                  mode={
                    view === "player" && (page === "player" || turning) && !covered
                      ? "visible"
                      : "hidden"
                  }
                  name="Player"
                >
                  <PlayerPane item={item} details={details} playing={playing} />
                </Activity>
              </>
            )}

            <DismissArea style={{ paddingTop: CELL * 3, gap: CELL * 2 }}>
              <Scrubber />
              <Transport />
              {/*
               * The four slots (Settings › Layout › Now Playing), then Queue on the right. The
               * song controls share one lookup after settlement or their own early tap.
               */}
              <View
                className={`flex-row items-center ${slots.length === 0 ? "justify-end" : "justify-between"}`}
              >
                {slots.map(({ action, slot }) => (
                  <SlotButton key={slot} slot={slot} action={action} context={slotContext} />
                ))}
                <ViewToggle
                  icon={IconListNumbers}
                  label={strings.playbackText.queue}
                  on={screen === "queue"}
                  onPress={openQueue}
                />
              </View>
            </DismissArea>
            {item !== null && <QueueEdgeMark onPress={openQueue} />}
          </ScreenPage>
        </View>
      </View>
      {/* Related, over the header, the pages and the controls; mounted while it shows or moves. */}
      {item !== null && relatedMounted && (
        <RelatedPanel pages={pages} ground={ground}>
          <RelatedView item={item} videoId={videoId} findAgain={findAgain} pages={pages} />
        </RelatedPanel>
      )}
      {/* The lyrics card's preview, over the whole sheet (Share in the Lyrics view). */}
      <LyricCardLayer />
    </Animated.View>
  );
}
