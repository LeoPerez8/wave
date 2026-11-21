import { useLocalisation } from "@/localisation/localisation";
import { activeTiming, beginTiming, timingSurfaceCommitted } from "@/lib/timing";
import { IconChevronDown, IconDotsVertical } from "@tabler/icons-react-native";
import {
  NOW_PLAYING_FOOTER_SLOTS,
  NOW_PLAYING_TRANSPORT_SLOTS,
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
import { SlotButton, type SlotContext } from "./SlotButtons";
import { Transport } from "./Transport";
import {
  nowPlayingSongLookup,
  songActionFailed,
  usePlayingSongTarget,
  usePreparePlayingSong,
} from "./playingSong";

/** What fills the player's space above the controls. The Queue is a screen of its own. */
export type NowPlayingView = "player" | "lyrics" | "related";

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
 * The player view. It stays mounted, hidden (`Activity`) while the Queue,
 * Lyrics or Related shows, so coming back to it draws the artwork straight away; hidden,
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
 * (artwork, title, artist and album), the Lyrics view or the Related view
 * sits above the scrubber and transport; the Queue is a screen of its own, a
 * swipe to the right of them (`ScreenPages`). Drag it down or tap the chevron
 * to dismiss it; Back leaves the Queue first.
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
  const [chosenView, setView] = useState<NowPlayingView>("player");
  const ytMusic = useYtMusicEnabled();
  // Related needs YouTube Music: turned off, the player shows in its place.
  const view = chosenView === "related" && !ytMusic ? "player" : chosenView;
  const { videoId, findAgain } = usePlayingVideoId(view === "related" ? trackId : null, ytSong);
  const showPlayer = useCallback(() => setView("player"), []);
  // The player and the Queue, side by side; the Queue stays mounted once shown (`QueuePane`).
  const pages = useScreenPages();
  const { screen, turning, send } = pages;
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
  // Related shows in the player, so asked for from the Queue it leaves the Queue.
  useEffect(
    () =>
      onRelatedOpened(() => {
        setView("related");
        send({ type: "show", screen: "player" });
      }),
    [send],
  );
  // The Queue is the playing song's: with nothing playing, the player shows.
  const nothingPlaying = item === null;
  useEffect(() => {
    if (nothingPlaying) send({ type: "show", screen: "player" });
  }, [nothingPlaying, send]);

  // Back leaves the Queue; on the player it slides the sheet away instead of
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

  // The Queue slot's button and the edge mark open the Queue screen.
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
    queueShown: screen === "queue",
    openQueue,
    share,
  };
  const slotSong: NowPlayingSlotSong =
    item === null
      ? "nothing"
      : trackId !== null && isUnsearchedTrackId(trackId)
        ? "unsearched"
        : "song";
  const buttons = useNowPlayingButtons();
  // A slot's button; null while the slot is None or its action hides for what's on.
  const slotButton = (slot: number) => {
    const action = buttons[slot] ?? null;
    if (action === null || nowPlayingSlotShow(action, slotSong) === "hidden") return null;
    return <SlotButton key={slot} slot={slot} action={action} context={slotContext} />;
  };
  // The footer's buttons, spread evenly; an empty slot leaves the row.
  const footer = Array.from({ length: NOW_PLAYING_FOOTER_SLOTS }, (_, slot) =>
    slotButton(slot),
  ).filter((button) => button !== null);
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
        importantForAccessibility={lyricSharing ? "no-hide-descendants" : "auto"}
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
                mode={screen === "queue" || turning ? "visible" : "hidden"}
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
                {view === "related" && (
                  <RelatedView
                    item={item}
                    videoId={videoId}
                    findAgain={findAgain}
                    onShowPlayer={showPlayer}
                  />
                )}
                <Activity
                  mode={
                    view === "player" && (screen === "player" || turning) ? "visible" : "hidden"
                  }
                  name="Player"
                >
                  <PlayerPane item={item} details={details} playing={playing} />
                </Activity>
              </>
            )}

            <DismissArea style={{ paddingTop: CELL * 3, gap: CELL * 2 }}>
              <Scrubber />
              <Transport
                left={slotButton(NOW_PLAYING_TRANSPORT_SLOTS.left)}
                right={slotButton(NOW_PLAYING_TRANSPORT_SLOTS.right)}
              />
              {/*
               * The five footer slots (Settings › Layout › Now Playing). Empty, the row keeps
               * its height, so the transport stays put. The song controls share one lookup
               * after settlement or their own early tap.
               */}
              <View
                className={`flex-row items-center ${footer.length === 1 ? "justify-center" : "justify-between"}`}
                style={{ minHeight: CELL * 6 }}
              >
                {footer}
              </View>
            </DismissArea>
            {item !== null && <QueueEdgeMark onPress={openQueue} />}
          </ScreenPage>
        </View>
      </View>
      {/* The lyrics card's preview, over the whole sheet (Share in the Lyrics view). */}
      <LyricCardLayer />
    </Animated.View>
  );
}
