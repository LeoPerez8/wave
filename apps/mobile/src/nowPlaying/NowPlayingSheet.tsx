import { useRenderCost } from "@/lib/renderCost";
import { useLocalisation } from "@/localisation/localisation";
import { activeTiming, beginTiming, timingSurfaceCommitted } from "@/lib/timing";
import { IconChevronDown, IconDotsVertical } from "@tabler/icons-react-native";
import {
  NOW_PLAYING_FOOTER_SLOTS,
  NOW_PLAYING_TRANSPORT_SLOTS,
  isUnsearchedTrackId,
  nowPlayingPageSwipesEnabled,
  nowPlayingRelatedSwipeEnabled,
  nowPlayingSlotRunsSongMenu,
  nowPlayingSlotShow,
  nowPlayingSongMenuShow,
  type NowPlayingSlotSong,
} from "@wave/core";
import type { ComponentRef, ReactNode } from "react";
import {
  Activity,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CELL, grid } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import { TextButton } from "@/components/TextButton";
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
import { moveSavedNowPlayingButton, useNowPlayingButtons } from "@/settings/nowPlayingButtons";
import { showNowPlayingEditHint } from "@/settings/nowPlayingEditHint";
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
import {
  QueueEdgeMark,
  RelatedRiseArea,
  ScreenPage,
  useScreenPages,
  type RelatedRise,
} from "./ScreenPages";
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
import { EditSlot, SlotButton, SlotDragPreview, type SlotContext } from "./SlotButtons";
import { useNowPlayingSlotDrag } from "./slotDrag";
import { useWarmPanes } from "./useWarmPanes";
import { usePlayingSongMenu } from "./songMenuSlots";
import { EDITING_OPACITY, Transport } from "./Transport";
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
    <RelatedRiseArea style={{ flex: 1 }}>
      <DismissArea style={PLAYER_AREA}>
        <PlayerView item={item} details={details} playing={playing} />
      </DismissArea>
    </RelatedRiseArea>
  );
});

/** Edit mode's look for everything but the slots and Done. */
const DIMMED = { opacity: EDITING_OPACITY } as const;

/** Done sits on the side margin, where the header's icons draw their glyphs. */
const DONE = { marginRight: 12 } as const;

/** Edit mode's line under the footer. */
const EDIT_NOTE = {
  position: "absolute",
  left: 0,
  right: 0,
  top: "100%",
  marginTop: CELL / 2,
  textAlign: "center",
} as const;

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
 * leaves edit mode first, then the Queue or Related.
 *
 * A long press on a slot starts edit mode: all seven slots show outlined
 * (`EditSlot`), a tap on one opens the card that changes it, the rest of the
 * player dims and takes no touches, and the header shows Done.
 *
 * It stays mounted out of sight below the screen, following the playing track
 * (its colours, artwork and links) while closed, so opening it only starts the
 * spring and its first frame is already right.
 */
export function NowPlayingSheet() {
  const { strings } = useLocalisation();
  useRenderCount("NowPlayingSheet");
  useRenderCost("NowPlayingSheet");
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
  const [view, setView] = useState<NowPlayingView>("player");
  const ytMusic = useYtMusicEnabled();
  const showPlayer = useCallback(() => setView("player"), []);
  // The player and the Queue, side by side; the Queue mounts as `useWarmPanes` says.
  // Related rises over them.
  const pages = useScreenPages();
  const { screen, editing, page, turning, send } = pages;
  // Lyrics and the Queue set text all down the ground; the player only from its title.
  const gradient = useNowPlayingGradient(palette, view === "lyrics" || screen !== "player");
  const ground = useBackgroundColors(gradient, shown);
  // Related needs YouTube Music: turned off, it goes in this render, ahead of
  // the effect that takes the screens back to the player.
  // Settled, Related covers the pages: what is under it rests until it moves.
  const covered = ytMusic && screen === "related" && !pages.relatedMoving;
  // Related stays drawn, with its songs, while its panel leaves.
  const relatedMounted = ytMusic && (screen === "related" || pages.relatedMoving);
  // The page gestures sit under Related's carousel, so they must stand down while it shows.
  const pageSwipesEnabled = nowPlayingPageSwipesEnabled({ screen, editing }) && !relatedMounted;
  // A drag up on the player raises Related. It doesn't wait on `relatedMounted`: the drag
  // itself draws the panel, which turns the page swipes off under the finger.
  const { related, relatedRiseBegan, relatedRiseEnded } = pages;
  const riseEnabled = nowPlayingRelatedSwipeEnabled({
    screens: { screen, editing },
    ytMusic,
    playing: item !== null,
  });
  const rise = useMemo<RelatedRise>(
    () => ({ enabled: riseEnabled, related, relatedRiseBegan, relatedRiseEnded }),
    [riseEnabled, related, relatedRiseBegan, relatedRiseEnded],
  );
  const { videoId, findAgain } = usePlayingVideoId(relatedMounted ? trackId : null, ytSong);
  // Once Now Playing has settled open, the Queue and Related's panel mount hidden (`Activity`,
  // drawn at low priority), so a first swipe or rise finds them drawn (#1380). Closed, they
  // unmount a few seconds later, or at a memory warning, so track changes don't re-render them.
  const warm = useWarmPanes(shown, settled);
  // Before then, only a Queue that is showing, or a swipe toward it, mounts it.
  const queueMounted = warm || (shown && (screen === "queue" || page === "queue" || turning));
  // Related opens fresh each time, as when it mounted on opening: a panel that has left is
  // replaced, hidden, by a new one.
  const [relatedGeneration, setRelatedGeneration] = useState(0);
  const [relatedWasMounted, setRelatedWasMounted] = useState(relatedMounted);
  if (relatedWasMounted !== relatedMounted) {
    setRelatedWasMounted(relatedMounted);
    if (!relatedMounted) setRelatedGeneration((generation) => generation + 1);
  }
  const playerPageInSight = (page === "player" || turning) && !covered;
  const leaveQueue = useCallback(() => void send({ type: "headerTap" }), [send]);
  // Where the pages sit on the sheet, for the Queue's sticky bar.
  const [pagesTop, setPagesTop] = useState(0);
  useLayoutEffect(() => {
    if (shown) nowPlayingContentCommitted();
  }, [shown]);
  // The first open on this phone says the screen is editable.
  useEffect(() => showNowPlayingEditHint(shown), [shown]);
  useLayoutEffect(() => {
    if (screen !== "queue") return;
    const active = activeTiming();
    if (active?.kind === "queue") timingSurfaceCommitted(active.id);
  }, [screen]);
  useLayoutEffect(() => {
    const active = activeTiming();
    if (
      active !== null &&
      ((screen === "related" && active.kind === "relatedOpen") ||
        (screen !== "related" && active.kind === "relatedClose"))
    )
      timingSurfaceCommitted(active.id);
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

  // Back leaves edit mode, then the Queue or Related; on the player it slides the sheet
  // away instead of leaving the screen under it (Core's `stepNowPlayingScreens`).
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

  // The Queue slot's button and the edge mark open the Queue screen (a swipe times its own open).
  const openQueue = () => {
    if (item === null) return;
    if (screen !== "queue") beginTiming("queue", "Queue");
    send({ type: "show", screen: "queue" });
  };
  const startEditing = useCallback(() => void send({ type: "edit" }), [send]);
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
  const buttons = useNowPlayingButtons();
  // The playing song's card, read while a slot runs one of its entries (Magic Queue, Go to).
  const slotMenu = usePlayingSongMenu(
    trackId,
    ytSong,
    shown && buttons.some((action) => action !== null && nowPlayingSlotRunsSongMenu(action)),
  );
  const slotContext: SlotContext = {
    trackId,
    ytSong,
    title: item?.title ?? strings.playbackText.unknownTitle,
    lyricsShown: view === "lyrics",
    toggleLyrics,
    queueShown: screen === "queue",
    openQueue,
    share,
    edit: startEditing,
    runSongMenu: slotMenu.run,
  };
  const slotSong: NowPlayingSlotSong =
    item === null
      ? "nothing"
      : trackId !== null && isUnsearchedTrackId(trackId)
        ? "unsearched"
        : "song";
  const applySlotMove = useCallback(
    (from: number, to: number) => moveSavedNowPlayingButton(from, to),
    [],
  );
  // The sheet the dragged slot's preview is drawn in, and the slots are measured against.
  const sheet = useRef<ComponentRef<typeof View>>(null);
  const slotDrag = useNowPlayingSlotDrag(applySlotMove, sheet);
  // A slot's button; null while the slot is None or its action hides for what's on.
  // In edit mode every slot shows, outlined, and opens its card instead.
  const slotButton = (slot: number) => {
    const action = buttons[slot] ?? null;
    if (editing) return <EditSlot key={slot} slot={slot} action={action} drag={slotDrag} />;
    const show =
      action === null ? "hidden" : nowPlayingSlotShow(action, slotSong, slotMenu.actions);
    if (action === null || show === "hidden") return null;
    return <SlotButton key={slot} action={action} off={show === "off"} context={slotContext} />;
  };
  // What edit mode dims: it shows through, takes no touches and screen readers skip it.
  const dimmed = {
    style: editing ? DIMMED : undefined,
    pointerEvents: editing ? "none" : "auto",
    importantForAccessibility: editing ? "no-hide-descendants" : "auto",
    accessibilityElementsHidden: editing,
  } as const;
  // The footer's buttons, spread evenly; an empty slot leaves the row.
  const footer = Array.from({ length: NOW_PLAYING_FOOTER_SLOTS }, (_, slot) =>
    slotButton(slot),
  ).filter((button) => button !== null);
  const songMenu = nowPlayingSongMenuShow(slotSong);

  return (
    <Animated.View
      ref={sheet}
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
            {/* In edit mode the header holds only Done, at the right; a drag down still closes. */}
            {editing ? (
              <View />
            ) : (
              <IconButton
                icon={IconChevronDown}
                label={strings.playbackText.closeNowPlaying}
                onPress={close}
              />
            )}
            {editing && (
              <TextButton
                label={strings.playbackText.doneEditing}
                onPress={() => void send({ type: "done" })}
                style={DONE}
              />
            )}
            {/* The playing song's card, anchored here; off while an unsearched entry's search runs. */}
            {!editing && songMenu !== "hidden" && (
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
          {item !== null && queueMounted && (
            <ScreenPage screen="queue" pages={pages} swipes={pageSwipesEnabled}>
              <Activity
                mode={(page === "queue" || turning) && !covered ? "visible" : "hidden"}
                name={strings.playbackText.queue}
              >
                <QueuePane item={item} ground={ground} top={pagesTop} onShowPlayer={leaveQueue} />
              </Activity>
            </ScreenPage>
          )}
          {/*
           * The player's page: a swipe to the left anywhere but the scrubber brings the Queue,
           * and a drag up anywhere but the lyrics themselves raises Related (`RelatedRiseArea`).
           */}
          <ScreenPage
            screen="player"
            pages={pages}
            swipes={pageSwipesEnabled && item !== null}
            rise={rise}
          >
            <View className="flex-1" {...dimmed}>
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
                  {/*
                   * Hidden while the Queue or Related covers it, Lyrics stays open but follows
                   * no playhead, and Back goes to the screens first.
                   */}
                  {view === "lyrics" && (
                    <Activity
                      mode={playerPageInSight ? "visible" : "hidden"}
                      name={strings.playbackText.lyrics}
                    >
                      <LyricsView
                        file={lyricsFile}
                        nonDTrackId={nonDTrackId}
                        item={item}
                        palette={palette}
                        gradient={gradient}
                        onShowPlayer={showPlayer}
                      />
                    </Activity>
                  )}
                  <Activity
                    mode={view === "player" && playerPageInSight ? "visible" : "hidden"}
                    name="Player"
                  >
                    <PlayerPane item={item} details={details} playing={playing} />
                  </Activity>
                </>
              )}
            </View>

            <RelatedRiseArea>
              <DismissArea style={{ paddingTop: CELL * 3, gap: CELL * 2 }}>
                <View {...dimmed}>
                  <Scrubber />
                </View>
                <Transport
                  left={slotButton(NOW_PLAYING_TRANSPORT_SLOTS.left)}
                  right={slotButton(NOW_PLAYING_TRANSPORT_SLOTS.right)}
                  editing={editing}
                />
                {/*
                 * The five footer slots (Settings › Layout's Now Playing editor). Empty, the row keeps
                 * its height, so the transport stays put. The song controls share one lookup
                 * after settlement or their own early tap.
                 */}
                <View>
                  <View
                    className={`flex-row items-center ${footer.length === 1 ? "justify-center" : "justify-between"}`}
                    style={{ minHeight: CELL * 6 }}
                  >
                    {footer}
                  </View>
                  {/* Under the slots, in the sheet's bottom margin, so nothing above it moves. */}
                  {editing && (
                    <Text
                      className="font-sans text-caption text-secondary"
                      style={EDIT_NOTE}
                      numberOfLines={1}
                    >
                      {strings.playbackText.tapASlotToChooseItsAction}
                    </Text>
                  )}
                </View>
              </DismissArea>
            </RelatedRiseArea>
            {item !== null && !editing && <QueueEdgeMark onPress={openQueue} />}
          </ScreenPage>
        </View>
      </View>
      {/*
       * Related, over the header, the pages and the controls; drawn while it shows or moves,
       * hidden otherwise once Now Playing has settled.
       */}
      {item !== null && ytMusic && (relatedMounted || warm) && (
        <Activity
          key={relatedGeneration}
          mode={relatedMounted ? "visible" : "hidden"}
          name={strings.playbackText.related}
        >
          <RelatedPanel pages={pages} ground={ground}>
            <RelatedView item={item} videoId={videoId} findAgain={findAgain} pages={pages} />
          </RelatedPanel>
        </Activity>
      )}
      {/* The lyrics card's preview, over the whole sheet (Share in the Lyrics view). */}
      <LyricCardLayer />
      {slotDrag.dragging !== null && (
        <SlotDragPreview drag={slotDrag} action={buttons[slotDrag.dragging] ?? null} />
      )}
    </Animated.View>
  );
}
