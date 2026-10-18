import { IconX } from "@tabler/icons-react-native";
import {
  RECAP_SLIDE_MS,
  recapBack,
  recapBarFill,
  recapForward,
  recapHourLabel,
  recapWeekdayLabel,
  type RecapGenre,
} from "@wave/core";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import {
  GestureDetector,
  useExclusiveGestures,
  useLongPressGesture,
  usePanGesture,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  Keyframe,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { ArtistImage } from "@/catalog/ArtistImage";
import { Artwork } from "@/catalog/Artwork";
import { CELL, grid } from "@/catalog/grid";
import { Press } from "@/motion/Press";
import type { AlbumRow, ArtistRow, SongRow } from "@/library/LibraryStore";

import type { LoadedRecap, LoadedRecapSlide, Ranked } from "./Stats";
import { playCount } from "./StatsViews";

/** A tap on the screen's left third goes back; anywhere else goes forward. */
const BACK_ZONE = 1 / 3;
/** How long a touch is held before the stories pause. */
const HOLD_MS = 200;
/** A drag down this far (dp), or flung this fast (dp/s), closes the stories. */
const CLOSE_DRAG = 120;
const CLOSE_VELOCITY = 800;
const DRAG_SLOP = 12;
const SPRING = { damping: 24, stiffness: 260 } as const;

/** A slide's lines rise into place one after another. */
const slideRise = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 24 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: Easing.out(Easing.exp) },
}).duration(520);
const slideFade = FadeIn.duration(150).reduceMotion(ReduceMotion.Never);

/** One line of a slide, rising in after `step` others. */
function Rise({ step, children }: { step: number; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View entering={reduceMotion ? slideFade : slideRise.delay(step * 120)}>
      {children}
    </Animated.View>
  );
}

/** Each slide kind's backdrop: a tile colour, white ink on it. */
const BACKDROP: Record<LoadedRecapSlide["kind"], string> = {
  minutes: "bg-tile-indigo",
  topSongs: "bg-tile-pink",
  topArtists: "bg-tile-purple",
  topAlbum: "bg-tile-blue",
  topGenres: "bg-tile-orange",
  habits: "bg-tile-green",
  discovered: "bg-tile-red",
};

function MinutesSlide({ title, minutes }: { title: string; minutes: number }) {
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 2 }}>
      <Rise step={0}>
        <Text className="font-sans text-title3 text-on-tile">In {title} you listened for</Text>
      </Rise>
      <Rise step={1}>
        <Text
          adjustsFontSizeToFit
          numberOfLines={1}
          className="font-sans font-bold text-on-tile"
          style={{ fontSize: 96, lineHeight: 104, fontVariant: ["tabular-nums"] }}
        >
          {minutes.toLocaleString("en")}
        </Text>
      </Rise>
      <Rise step={2}>
        <Text className="font-sans text-title1 font-semibold text-on-tile">
          {minutes === 1 ? "minute" : "minutes"}
        </Text>
      </Rise>
    </View>
  );
}

const artworkUri = (song: SongRow): string | undefined => {
  const path = song.artworkPath ?? song.thumbPath;
  return path === null ? undefined : `file://${path}`;
};

function TopSongsSlide({ songs }: { songs: readonly Ranked<SongRow>[] }) {
  const [top, ...rest] = songs;
  if (top === undefined) return null;
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 3 }}>
      <Rise step={0}>
        <Text className="font-sans text-title3 text-on-tile">Your top songs</Text>
      </Rise>
      <Rise step={1}>
        <View style={{ gap: CELL * 1.5 }}>
          <Artwork uri={artworkUri(top.item)} size={CELL * 26} radius={12} />
          <View>
            <Text className="font-sans text-footnote font-semibold text-on-tile opacity-80">
              #1 · {playCount(top.countedPlays)}
            </Text>
            <Text numberOfLines={2} className="font-sans text-title1 font-bold text-on-tile">
              {top.item.title}
            </Text>
            <Text numberOfLines={1} className="font-sans text-body text-on-tile opacity-80">
              {top.item.artist}
            </Text>
          </View>
        </View>
      </Rise>
      <View style={{ gap: CELL * 1.5 }}>
        {rest.map((entry, index) => (
          <Rise key={entry.item.id} step={index + 2}>
            <View className="flex-row items-center" style={{ gap: CELL * 2 }}>
              <Text
                className="font-sans text-title3 font-semibold text-on-tile"
                style={{ width: CELL * 3, fontVariant: ["tabular-nums"] }}
              >
                {index + 2}
              </Text>
              <View className="flex-1">
                <Text numberOfLines={1} className="font-sans text-body font-semibold text-on-tile">
                  {entry.item.title}
                </Text>
                <Text numberOfLines={1} className="font-sans text-footnote text-on-tile opacity-80">
                  {entry.item.artist} · {playCount(entry.countedPlays)}
                </Text>
              </View>
            </View>
          </Rise>
        ))}
      </View>
    </View>
  );
}

/** A slide's heading: the first line to rise in. */
function Heading({ children }: { children: ReactNode }) {
  return (
    <Rise step={0}>
      <Text className="font-sans text-title3 text-on-tile">{children}</Text>
    </Rise>
  );
}

/** A numbered line under a slide's #1: rank, an optional image, a title over its detail. */
function RankedLine({
  rank,
  step,
  image,
  title,
  detail,
}: {
  rank: number;
  step: number;
  image?: ReactNode;
  title: string;
  detail?: string;
}) {
  return (
    <Rise step={step}>
      <View className="flex-row items-center" style={{ gap: CELL * 2 }}>
        <Text
          className="font-sans text-title3 font-semibold text-on-tile"
          style={{ width: CELL * 3, fontVariant: ["tabular-nums"] }}
        >
          {rank}
        </Text>
        {image}
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-semibold text-on-tile">
            {title}
          </Text>
          {detail !== undefined && (
            <Text numberOfLines={1} className="font-sans text-footnote text-on-tile opacity-80">
              {detail}
            </Text>
          )}
        </View>
      </View>
    </Rise>
  );
}

function TopArtistsSlide({ artists }: { artists: readonly Ranked<ArtistRow>[] }) {
  const [top, ...rest] = artists;
  if (top === undefined) return null;
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 3 }}>
      <Heading>Your top artists</Heading>
      <Rise step={1}>
        <View style={{ gap: CELL * 1.5 }}>
          <ArtistImage artist={top.item} size={CELL * 22} large />
          <View>
            <Text className="font-sans text-footnote font-semibold text-on-tile opacity-80">
              #1 · {playCount(top.countedPlays)}
            </Text>
            <Text numberOfLines={2} className="font-sans text-title1 font-bold text-on-tile">
              {top.item.name}
            </Text>
          </View>
        </View>
      </Rise>
      <View style={{ gap: CELL * 1.5 }}>
        {rest.map((entry, index) => (
          <RankedLine
            key={entry.item.id}
            rank={index + 2}
            step={index + 2}
            image={<ArtistImage artist={entry.item} size={CELL * 5} />}
            title={entry.item.name}
            detail={playCount(entry.countedPlays)}
          />
        ))}
      </View>
    </View>
  );
}

function TopAlbumSlide({ album }: { album: Ranked<AlbumRow> }) {
  const path = album.item.artworkPath ?? album.item.thumbPath;
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 3 }}>
      <Heading>Your top album</Heading>
      <Rise step={1}>
        <Artwork uri={path === null ? undefined : `file://${path}`} size={CELL * 32} radius={12} />
      </Rise>
      <Rise step={2}>
        <View>
          <Text numberOfLines={2} className="font-sans text-title1 font-bold text-on-tile">
            {album.item.title}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-on-tile opacity-80">
            {album.item.albumArtist} · {playCount(album.countedPlays)}
          </Text>
        </View>
      </Rise>
    </View>
  );
}

const percent = (share: number): string => `${Math.round(share * 100)}%`;

function TopGenresSlide({ genres }: { genres: readonly RecapGenre[] }) {
  const [top, ...rest] = genres;
  if (top === undefined) return null;
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 3 }}>
      <Heading>Your top genres</Heading>
      <Rise step={1}>
        <View>
          <Text className="font-sans text-footnote font-semibold text-on-tile opacity-80">
            #1 · {percent(top.share)} of your plays
          </Text>
          <Text
            adjustsFontSizeToFit
            numberOfLines={1}
            className="font-sans font-bold text-on-tile"
            style={{ fontSize: 56, lineHeight: 64 }}
          >
            {top.family.name}
          </Text>
        </View>
      </Rise>
      <View style={{ gap: CELL * 1.5 }}>
        {rest.map((entry, index) => (
          <RankedLine
            key={entry.family.key}
            rank={index + 2}
            step={index + 2}
            title={entry.family.name}
            detail={percent(entry.share)}
          />
        ))}
      </View>
    </View>
  );
}

function HabitsSlide({
  peakHour,
  peakWeekday,
  longestStreakDays,
}: {
  peakHour: number;
  peakWeekday: number;
  longestStreakDays: number;
}) {
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 4 }}>
      <Heading>You listened most</Heading>
      <Rise step={1}>
        <Text className="font-sans text-title1 font-bold text-on-tile">
          on {recapWeekdayLabel(peakWeekday)}
        </Text>
        <Text className="font-sans text-title1 font-bold text-on-tile">
          around {recapHourLabel(peakHour)}
        </Text>
      </Rise>
      <Rise step={2}>
        <Text className="font-sans text-title3 text-on-tile">Your longest streak</Text>
        <Text
          className="font-sans font-bold text-on-tile"
          style={{ fontSize: 56, lineHeight: 64, fontVariant: ["tabular-nums"] }}
        >
          {longestStreakDays}
        </Text>
        <Text className="font-sans text-title3 font-semibold text-on-tile">
          {longestStreakDays === 1 ? "day" : "days in a row"}
        </Text>
      </Rise>
    </View>
  );
}

function DiscoveredSlide({
  count,
  artists,
}: {
  count: number;
  artists: readonly Ranked<ArtistRow>[];
}) {
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 3 }}>
      <Heading>You discovered</Heading>
      <Rise step={1}>
        <Text
          className="font-sans font-bold text-on-tile"
          style={{ fontSize: 72, lineHeight: 80, fontVariant: ["tabular-nums"] }}
        >
          {count.toLocaleString("en")}
        </Text>
        <Text className="font-sans text-title1 font-semibold text-on-tile">
          {count === 1 ? "new artist" : "new artists"}
        </Text>
      </Rise>
      <View style={{ gap: CELL * 1.5 }}>
        {artists.map((entry, index) => (
          <RankedLine
            key={entry.item.id}
            rank={index + 1}
            step={index + 2}
            image={<ArtistImage artist={entry.item} size={CELL * 5} />}
            title={entry.item.name}
            detail={playCount(entry.countedPlays)}
          />
        ))}
      </View>
    </View>
  );
}

function Slide({ recap, slide }: { recap: LoadedRecap; slide: LoadedRecapSlide }) {
  switch (slide.kind) {
    case "minutes":
      return <MinutesSlide title={recap.title} minutes={slide.minutes} />;
    case "topSongs":
      return <TopSongsSlide songs={slide.songs} />;
    case "topArtists":
      return <TopArtistsSlide artists={slide.artists} />;
    case "topAlbum":
      return <TopAlbumSlide album={slide.album} />;
    case "topGenres":
      return <TopGenresSlide genres={slide.genres} />;
    case "habits":
      return (
        <HabitsSlide
          peakHour={slide.peakHour}
          peakWeekday={slide.peakWeekday}
          longestStreakDays={slide.longestStreakDays}
        />
      );
    case "discovered":
      return <DiscoveredSlide count={slide.count} artists={slide.artists} />;
  }
}

/** One progress bar: the slide showing fills as it plays; the others are full or empty. */
function ProgressBar({
  bar,
  index,
  progress,
}: {
  bar: number;
  index: number;
  progress: SharedValue<number>;
}) {
  const filling = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }));
  return (
    <View className="flex-1 overflow-hidden rounded-full bg-on-tile/30" style={{ height: 3 }}>
      <Animated.View
        className="h-full rounded-full bg-on-tile"
        style={bar === index ? filling : { width: `${recapBarFill(bar, index, 0) * 100}%` }}
      />
    </View>
  );
}

/**
 * A Recap's stories: full-screen slides that move on by themselves, with a
 * progress bar for each at the top. A tap on the right goes forward (past the
 * last slide, it closes), on the left back; holding pauses; dragging down or
 * the close button closes. `recap` is undefined while it loads and null when
 * the period has no Recap.
 */
export function RecapStories({
  recap,
  onClose,
}: {
  recap: LoadedRecap | null | undefined;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  /** Goes up each time back restarts a slide, so its timer and entrance start again. */
  const [restarts, setRestarts] = useState(0);
  const progress = useSharedValue(0);
  const offset = useSharedValue(0);
  const width = useRef(1);
  const closed = useRef(false);
  const count = recap?.slides.length ?? 0;

  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onClose();
  }, [onClose]);

  const forward = useCallback(() => {
    const next = recapForward(index, count);
    if (next === null) close();
    else {
      progress.set(0);
      setIndex(next);
    }
  }, [close, count, index, progress]);

  const back = useCallback(() => {
    progress.set(0);
    // Back on the first slide restarts it: the timer below starts again.
    setIndex((current) => recapBack(current));
    setRestarts((n) => n + 1);
  }, [progress]);

  // The slide showing plays out its time, then the stories move on; a pause
  // holds the bar where it is and the rest of the time resumes after.
  useEffect(() => {
    if (count === 0 || paused) {
      cancelAnimation(progress);
      return;
    }
    progress.set(
      withTiming(
        1,
        { duration: (1 - progress.get()) * RECAP_SLIDE_MS, easing: Easing.linear },
        (finished) => {
          "worklet";
          if (finished === true) scheduleOnRN(forward);
        },
      ),
    );
    return () => cancelAnimation(progress);
    // `index` and `restarts` aren't read in here: a new slide, or the same one again, restarts the timer.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [count, forward, paused, progress, index, restarts]);

  const settleDrag = useCallback(
    (translation: number, velocity: number) => {
      setPaused(false);
      if (translation > CLOSE_DRAG || velocity > CLOSE_VELOCITY) close();
      else offset.set(withSpring(0, { ...SPRING, velocity }));
    },
    [close, offset],
  );

  const tap = useTapGesture({
    runOnJS: true,
    maxDuration: HOLD_MS,
    onActivate: (event) => (event.x < width.current * BACK_ZONE ? back() : forward()),
  });
  const hold = useLongPressGesture({
    runOnJS: true,
    minDuration: HOLD_MS,
    onActivate: () => setPaused(true),
    onFinalize: () => setPaused(false),
  });
  const drag = usePanGesture({
    activeOffsetY: [-1_000_000, DRAG_SLOP],
    failOffsetX: [-DRAG_SLOP * 2, DRAG_SLOP * 2],
    onActivate: () => {
      "worklet";
      scheduleOnRN(setPaused, true);
    },
    onUpdate: (event) => {
      "worklet";
      offset.set(Math.max(0, event.translationY));
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(settleDrag, event.translationY, event.velocityY);
    },
  });
  const gesture = useExclusiveGestures(drag, hold, tap);

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.get() }],
    borderRadius: Math.min(offset.get() / 4, 24),
  }));

  const slide = recap?.slides[index];

  return (
    <View className="flex-1 bg-scrim">
      <StatusBar style="light" />
      <Animated.View
        accessibilityViewIsModal
        className={`flex-1 overflow-hidden ${slide === undefined ? "bg-scrim" : BACKDROP[slide.kind]}`}
        style={[{ paddingTop: insets.top + CELL }, dragStyle]}
        onLayout={(event) => {
          width.current = event.nativeEvent.layout.width;
        }}
      >
        <View className="flex-row" style={{ gap: CELL / 2, paddingHorizontal: CELL }}>
          {recap?.slides.map((_, bar) => (
            <ProgressBar key={bar} bar={bar} index={index} progress={progress} />
          ))}
        </View>
        <View
          className="flex-row items-center justify-between"
          style={{ paddingLeft: grid.margin, paddingRight: CELL / 2 }}
        >
          <Text numberOfLines={1} className="font-sans text-subheadline font-semibold text-on-tile">
            {recap?.title ?? ""}
          </Text>
          <Press
            accessibilityRole="button"
            accessibilityLabel="Close Recap"
            onPress={close}
            haptic="selection"
            className="items-center justify-center"
            style={{ width: 48, height: 48 }}
          >
            <IconX size={24} color="#ffffff" strokeWidth={1.5} />
          </Press>
        </View>
        {/* The slide takes the taps, holds and drags; the close button above stays its own. */}
        <GestureDetector gesture={gesture}>
          <View
            className="flex-1"
            style={{ paddingHorizontal: grid.margin, paddingBottom: insets.bottom + CELL * 3 }}
          >
            {recap === null ? (
              <View className="flex-1 justify-center">
                <Text className="font-sans text-title3 text-on-tile">
                  This Recap isn&apos;t available.
                </Text>
              </View>
            ) : recap !== undefined && slide !== undefined ? (
              // A new key replays the slide's entrance.
              <View key={`${index}-${restarts}`} className="flex-1">
                <Slide recap={recap} slide={slide} />
              </View>
            ) : null}
          </View>
        </GestureDetector>
      </Animated.View>
    </View>
  );
}
