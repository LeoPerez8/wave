import { useLocalisation } from "@/localisation/localisation";
import { IconShare3, IconX } from "@tabler/icons-react-native";
import {
  formatNumber,
  RECAP_SLIDE_MS,
  recapBack,
  recapAutoForward,
  recapBarFill,
  recapForward,
  recapTitle,
  type Catalogue,
  type GenreFamily,
  type RecapGenre,
  type RecapColour,
  type RecapPeriod,
  ytSongArtist,
} from "@wave/core";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState, type Key, type ReactNode } from "react";
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

import { artworkUri } from "@/catalog/artworkUri";
import { ArtistImage } from "@/catalog/ArtistImage";
import { Artwork } from "@/catalog/Artwork";
import { CELL, grid } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import type { PlayedAlbum, PlayedArtist } from "@/library/db/playedEntities";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { useInCapture } from "@/share/imageCapture";
import { useThemeColor } from "@/theme/useThemeColor";

import { RecapSharePreview } from "./RecapShare";
import type { LoadedRecap, LoadedRecapSlide, Ranked, StatsSong } from "./Stats";
import { useRecapMusic } from "./recapMusic";

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
  // A slide drawn into a shared image stands still.
  const still = useInCapture();
  if (still) return <View>{children}</View>;
  return (
    <Animated.View entering={reduceMotion ? slideFade : slideRise.delay(step * 120)}>
      {children}
    </Animated.View>
  );
}

/** Each slide kind's backdrop: a Recap colour, white ink on it. */
const BACKDROP: Record<LoadedRecapSlide["kind"], RecapColour> = {
  minutes: "indigo",
  topSongs: "pink",
  topArtists: "purple",
  topAlbum: "blue",
  topGenres: "orange",
  habits: "green",
  discovered: "red",
  summary: "indigo",
};

function MinutesSlide({ period, minutes }: { period: RecapPeriod; minutes: number }) {
  const { language, strings } = useLocalisation();
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 2 }}>
      <Rise step={0}>
        <Text className="font-sans text-title3 text-on-recap">
          {strings.recap.listenedIn(period)}
        </Text>
      </Rise>
      <Rise step={1}>
        <Text
          adjustsFontSizeToFit
          numberOfLines={1}
          className="font-sans font-bold text-on-recap"
          style={{ fontSize: 96, lineHeight: 104, fontVariant: ["tabular-nums"] }}
        >
          {formatNumber(language, minutes)}
        </Text>
      </Rise>
      <Rise step={2}>
        <Text className="font-sans text-title1 font-semibold text-on-recap">
          {strings.recap.minutes(minutes)}
        </Text>
      </Rise>
    </View>
  );
}

/**
 * A song as a Recap shows it: a Library song's, or a streamed one's as its
 * latest play had it, its cover a placeholder while YT Music is off.
 */
const songShown = (song: StatsSong, ytMusic: boolean) =>
  song.source === "library"
    ? {
        key: song.track.id,
        title: song.track.title,
        artist: song.track.artist,
        artworkUri: artworkUri(song.track, "original"),
      }
    : {
        key: song.song.videoId,
        title: song.song.title,
        artist: ytSongArtist(song.song),
        artworkUri: ytMusic ? (song.song.artworkUrl ?? undefined) : undefined,
      };

/** An album's cover as a Recap shows it: an online album's is a placeholder while YT Music is off. */
const albumArtworkUri = (album: PlayedAlbum, ytMusic: boolean): string | undefined =>
  "online" in album
    ? ytMusic
      ? (album.artworkUrl ?? undefined)
      : undefined
    : artworkUri(album, "original");

/** An artist's image as a Recap shows it: an online artist's is a placeholder while YT Music is off. */
const artistShown = (artist: PlayedArtist, ytMusic: boolean) =>
  "online" in artist ? { ...artist, placeholder: !ytMusic } : artist;

function TopSongsSlide({ songs: ranked }: { songs: readonly Ranked<StatsSong>[] }) {
  const { strings } = useLocalisation();
  const ytMusic = useYtMusicEnabled();
  const songs = ranked.map((entry) => ({ ...entry, item: songShown(entry.item, ytMusic) }));
  const [top, ...rest] = songs;
  if (top === undefined) return null;
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 3 }}>
      <Heading>{strings.recap.topSongs}</Heading>
      <Rise step={1}>
        <View style={{ gap: CELL * 1.5 }}>
          <Artwork uri={top.item.artworkUri} size={CELL * 26} radius={12} />
          <View>
            <Text className="font-sans text-footnote font-semibold text-on-recap opacity-80">
              #1 · {strings.stats.plays(top.countedPlays)}
            </Text>
            <Text numberOfLines={2} className="font-sans text-title1 font-bold text-on-recap">
              {top.item.title}
            </Text>
            <Text numberOfLines={1} className="font-sans text-body text-on-recap opacity-80">
              {top.item.artist}
            </Text>
          </View>
        </View>
      </Rise>
      <RankedLines
        entries={rest}
        firstRank={2}
        entryKey={(entry) => entry.item.key}
        line={(entry) => ({
          title: entry.item.title,
          detail: `${entry.item.artist} · ${strings.stats.plays(entry.countedPlays)}`,
        })}
      />
    </View>
  );
}

/** A slide's heading: the first line to rise in. */
function Heading({ children }: { children: ReactNode }) {
  return (
    <Rise step={0}>
      <Text className="font-sans text-title3 text-on-recap">{children}</Text>
    </Rise>
  );
}

/** What a ranked line shows besides its rank: an optional image, a title over its detail. */
interface RankedLineContent {
  image?: ReactNode;
  title: string;
  detail?: string;
}

/** A numbered line under a slide's #1: rank, an optional image, a title over its detail. */
function RankedLine({
  rank,
  step,
  image,
  title,
  detail,
}: RankedLineContent & { rank: number; step: number }) {
  return (
    <Rise step={step}>
      <View className="flex-row items-center" style={{ gap: CELL * 2 }}>
        <Text
          className="font-sans text-title3 font-semibold text-on-recap"
          style={{ width: CELL * 3, fontVariant: ["tabular-nums"] }}
        >
          {rank}
        </Text>
        {image}
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-semibold text-on-recap">
            {title}
          </Text>
          {detail !== undefined && (
            <Text numberOfLines={1} className="font-sans text-footnote text-on-recap opacity-80">
              {detail}
            </Text>
          )}
        </View>
      </View>
    </Rise>
  );
}

/**
 * A slide's numbered lines, ranked from [firstRank] (#2 under a #1 of its
 * own), each rising in after the slide's first lines.
 */
function RankedLines<T>({
  entries,
  firstRank,
  entryKey,
  line,
}: {
  entries: readonly T[];
  firstRank: number;
  entryKey: (entry: T) => Key;
  line: (entry: T) => RankedLineContent;
}) {
  return (
    <View style={{ gap: CELL * 1.5 }}>
      {entries.map((entry, index) => (
        <RankedLine
          key={entryKey(entry)}
          rank={index + firstRank}
          step={index + 2}
          {...line(entry)}
        />
      ))}
    </View>
  );
}

const artistKey = (entry: Ranked<PlayedArtist>): Key => entry.item.id;

/** An artist's ranked line: its image, its name over its plays. */
const artistLine =
  (ytMusic: boolean, strings: Catalogue) =>
  (entry: Ranked<PlayedArtist>): RankedLineContent => ({
    image: <ArtistImage artist={artistShown(entry.item, ytMusic)} size={CELL * 5} />,
    title: entry.item.name,
    detail: strings.stats.plays(entry.countedPlays),
  });

function TopArtistsSlide({ artists }: { artists: readonly Ranked<PlayedArtist>[] }) {
  const { strings } = useLocalisation();
  const ytMusic = useYtMusicEnabled();
  const [top, ...rest] = artists;
  if (top === undefined) return null;
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 3 }}>
      <Heading>{strings.recap.topArtists}</Heading>
      <Rise step={1}>
        <View style={{ gap: CELL * 1.5 }}>
          <ArtistImage artist={artistShown(top.item, ytMusic)} size={CELL * 22} large />
          <View>
            <Text className="font-sans text-footnote font-semibold text-on-recap opacity-80">
              #1 · {strings.stats.plays(top.countedPlays)}
            </Text>
            <Text numberOfLines={2} className="font-sans text-title1 font-bold text-on-recap">
              {top.item.name}
            </Text>
          </View>
        </View>
      </Rise>
      <RankedLines
        entries={rest}
        firstRank={2}
        entryKey={artistKey}
        line={artistLine(ytMusic, strings)}
      />
    </View>
  );
}

function TopAlbumSlide({ album }: { album: Ranked<PlayedAlbum> }) {
  const { strings } = useLocalisation();
  const ytMusic = useYtMusicEnabled();
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 3 }}>
      <Heading>{strings.recap.topAlbum}</Heading>
      <Rise step={1}>
        <Artwork uri={albumArtworkUri(album.item, ytMusic)} size={CELL * 32} radius={12} />
      </Rise>
      <Rise step={2}>
        <View>
          <Text numberOfLines={2} className="font-sans text-title1 font-bold text-on-recap">
            {album.item.title}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-on-recap opacity-80">
            {album.item.albumArtist} · {strings.stats.plays(album.countedPlays)}
          </Text>
        </View>
      </Rise>
    </View>
  );
}

const percent = (share: number): string => `${Math.round(share * 100)}%`;

function TopGenresSlide({ genres }: { genres: readonly RecapGenre[] }) {
  const { strings } = useLocalisation();
  const [top, ...rest] = genres;
  if (top === undefined) return null;
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 3 }}>
      <Heading>{strings.recap.topGenres}</Heading>
      <Rise step={1}>
        <View>
          <Text className="font-sans text-footnote font-semibold text-on-recap opacity-80">
            #1 · {strings.recap.shareOfPlays(percent(top.share))}
          </Text>
          <Text
            adjustsFontSizeToFit
            numberOfLines={1}
            className="font-sans font-bold text-on-recap"
            style={{ fontSize: 56, lineHeight: 64 }}
          >
            {top.family.name}
          </Text>
        </View>
      </Rise>
      <RankedLines
        entries={rest}
        firstRank={2}
        entryKey={(entry) => entry.family.key}
        line={(entry) => ({ title: entry.family.name, detail: percent(entry.share) })}
      />
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
  const { strings } = useLocalisation();
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 4 }}>
      <Heading>{strings.recap.listenedMost}</Heading>
      <Rise step={1}>
        <Text className="font-sans text-title1 font-bold text-on-recap">
          {strings.recap.onWeekday(peakWeekday)}
        </Text>
        <Text className="font-sans text-title1 font-bold text-on-recap">
          {strings.recap.aroundHour(peakHour)}
        </Text>
      </Rise>
      <Rise step={2}>
        <Text className="font-sans text-title3 text-on-recap">{strings.recap.longestStreak}</Text>
        <Text
          className="font-sans font-bold text-on-recap"
          style={{ fontSize: 56, lineHeight: 64, fontVariant: ["tabular-nums"] }}
        >
          {longestStreakDays}
        </Text>
        <Text className="font-sans text-title3 font-semibold text-on-recap">
          {strings.recap.streakDays(longestStreakDays)}
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
  artists: readonly Ranked<PlayedArtist>[];
}) {
  const { language, strings } = useLocalisation();
  const ytMusic = useYtMusicEnabled();
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 3 }}>
      <Heading>{strings.recap.discovered}</Heading>
      <Rise step={1}>
        <Text
          className="font-sans font-bold text-on-recap"
          style={{ fontSize: 72, lineHeight: 80, fontVariant: ["tabular-nums"] }}
        >
          {formatNumber(language, count)}
        </Text>
        <Text className="font-sans text-title1 font-semibold text-on-recap">
          {strings.recap.newArtists(count)}
        </Text>
      </Rise>
      <RankedLines
        entries={artists}
        firstRank={1}
        entryKey={artistKey}
        line={artistLine(ytMusic, strings)}
      />
    </View>
  );
}

/** A column of the summary card: a heading over up to 5 numbered names. */
function SummaryColumn({ heading, names }: { heading: string; names: readonly string[] }) {
  return (
    <View className="flex-1" style={{ gap: CELL }}>
      <Text className="font-sans text-footnote font-semibold text-on-recap opacity-80">
        {heading}
      </Text>
      {names.map((name, index) => (
        <Text
          // A name can repeat (two songs with one title); the rank can't.
          key={index}
          numberOfLines={1}
          className="font-sans text-subheadline font-semibold text-on-recap"
        >
          <Text style={{ fontVariant: ["tabular-nums"] }}>{index + 1} </Text>
          {name}
        </Text>
      ))}
    </View>
  );
}

/** A figure of the summary card: a label over a large value. */
function SummaryFigure({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1">
      <Text className="font-sans text-footnote font-semibold text-on-recap opacity-80">
        {label}
      </Text>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        className="font-sans text-title1 font-bold text-on-recap"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
    </View>
  );
}

/** The summary card, the last slide: top artists and songs, minutes and top genre, as Wrapped's. */
function SummarySlide({
  minutes,
  songs,
  artists,
  genre,
}: {
  minutes: number;
  songs: readonly Ranked<StatsSong>[];
  artists: readonly Ranked<PlayedArtist>[];
  genre: GenreFamily | null;
}) {
  const { language, strings } = useLocalisation();
  const ytMusic = useYtMusicEnabled();
  const top = artists[0];
  return (
    <View className="flex-1 justify-center" style={{ gap: CELL * 4 }}>
      {top !== undefined && (
        <Rise step={0}>
          <View className="items-center">
            <ArtistImage artist={artistShown(top.item, ytMusic)} size={CELL * 20} large />
          </View>
        </Rise>
      )}
      {(artists.length > 0 || songs.length > 0) && (
        <Rise step={1}>
          <View className="flex-row" style={{ gap: CELL * 2 }}>
            {artists.length > 0 && (
              <SummaryColumn
                heading={strings.recap.summaryTopArtists}
                names={artists.map((entry) => entry.item.name)}
              />
            )}
            {songs.length > 0 && (
              <SummaryColumn
                heading={strings.recap.summaryTopSongs}
                names={songs.map(({ item }) =>
                  item.source === "library" ? item.track.title : item.song.title,
                )}
              />
            )}
          </View>
        </Rise>
      )}
      <Rise step={2}>
        <View className="flex-row" style={{ gap: CELL * 2 }}>
          <SummaryFigure
            label={strings.recap.minutesListened}
            value={formatNumber(language, minutes)}
          />
          {genre !== null && <SummaryFigure label={strings.recap.topGenre} value={genre.name} />}
        </View>
      </Rise>
    </View>
  );
}

function Slide({ recap, slide }: { recap: LoadedRecap; slide: LoadedRecapSlide }) {
  switch (slide.kind) {
    case "minutes":
      return <MinutesSlide period={recap.period} minutes={slide.minutes} />;
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
    case "summary":
      return (
        <SummarySlide
          minutes={slide.minutes}
          songs={slide.songs}
          artists={slide.artists}
          genre={slide.genre}
        />
      );
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
    <View className="flex-1 overflow-hidden rounded-full bg-on-recap/30" style={{ height: 3 }}>
      <Animated.View
        className="h-full rounded-full bg-on-recap"
        style={bar === index ? filling : { width: `${recapBarFill(bar, index, 0) * 100}%` }}
      />
    </View>
  );
}

/**
 * A Recap's stories: full-screen slides that move on by themselves (the
 * summary card, last, stays), with a progress bar for each at the top. A tap on the right goes forward (past the
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
  const { strings } = useLocalisation();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [held, setPaused] = useState(false);
  const [readerPaused, setReaderPaused] = useState(false);
  /** The slide's share preview is open: the stories and their music wait under it. */
  const [sharing, setSharing] = useState(false);
  const paused = held || sharing || readerPaused;
  /** Goes up each time back restarts a slide, so its timer and entrance start again. */
  const [restarts, setRestarts] = useState(0);
  const progress = useSharedValue(0);
  const offset = useSharedValue(0);
  const width = useRef(1);
  const closed = useRef(false);
  const count = recap?.slides.length ?? 0;
  useRecapMusic(recap, index, paused);
  const slide = recap?.slides[index];
  // While the Recap loads (or when there's none), the viewer sits on grey.
  const backdrop = useThemeColor(`recap-${slide === undefined ? "grey" : BACKDROP[slide.kind]}`);
  const ink = useThemeColor("on-recap");
  const closeShare = useCallback(() => setSharing(false), []);

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

  // A slide's time ran out: on to the next, but the summary card stays.
  const timeUp = useCallback(() => {
    const next = recapAutoForward(index, count);
    if (next === null) return;
    progress.set(0);
    setIndex(next);
  }, [count, index, progress]);

  const back = useCallback(() => {
    progress.set(0);
    // Back on the first slide restarts it: the timer below starts again.
    setIndex((current) => recapBack(current));
    setRestarts((n) => n + 1);
  }, [progress]);

  // The slide showing plays out its time, then the stories move on (the
  // summary card's bar fills and stays); a pause holds the bar where it is
  // and the rest of the time resumes after.
  useEffect(() => {
    if (count === 0 || paused) {
      cancelAnimation(progress);
      return;
    }
    progress.set(
      withTiming(
        1,
        {
          duration: (1 - progress.get()) * RECAP_SLIDE_MS,
          easing: Easing.linear,
          // This is the story clock; reduced motion must not skip its reading time.
          reduceMotion: ReduceMotion.Never,
        },
        (finished) => {
          "worklet";
          if (finished === true) scheduleOnRN(timeUp);
        },
      ),
    );
    return () => cancelAnimation(progress);
    // `index` and `restarts` aren't read in here: a new slide, or the same one again, restarts the timer.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [count, timeUp, paused, progress, index, restarts]);

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

  return (
    <View className="flex-1 bg-background">
      <StatusBar style="light" />
      <Animated.View
        accessibilityViewIsModal
        importantForAccessibility={sharing ? "no-hide-descendants" : "auto"}
        className="flex-1 overflow-hidden"
        style={[{ paddingTop: insets.top + CELL, backgroundColor: backdrop }, dragStyle]}
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
          <Text
            accessibilityRole="header"
            accessibilityLabel={
              recap == null
                ? strings.recap.recap
                : strings.recap.slidePosition(recap.period, index + 1, count)
            }
            accessibilityValue={{ text: paused ? strings.recap.paused : strings.recap.playing }}
            accessibilityActions={
              count === 0
                ? []
                : [
                    { name: "previousSlide", label: strings.recap.previousSlide },
                    { name: "nextSlide", label: strings.recap.nextSlide },
                    {
                      name: "togglePause",
                      label: readerPaused
                        ? strings.recap.resumeStories
                        : strings.recap.pauseStories,
                    },
                  ]
            }
            onAccessibilityAction={({ nativeEvent: { actionName } }) => {
              if (actionName === "previousSlide") back();
              if (actionName === "nextSlide") forward();
              if (actionName === "togglePause") setReaderPaused((value) => !value);
            }}
            numberOfLines={1}
            className="flex-1 font-sans text-subheadline font-semibold text-on-recap"
          >
            {recap == null ? "" : recapTitle(recap.period, strings)}
          </Text>
          {recap !== null && recap !== undefined && slide !== undefined && (
            <IconButton
              label={strings.recap.shareSlide}
              onPress={() => setSharing(true)}
              depth={0.04}
            >
              <IconShare3 size={24} color={ink} strokeWidth={1.5} />
            </IconButton>
          )}
          <IconButton label={strings.recap.close} onPress={close} depth={0.04}>
            <IconX size={24} color={ink} strokeWidth={1.5} />
          </IconButton>
        </View>
        {/* The slide takes the taps, holds and drags; the close button above stays its own. */}
        <GestureDetector gesture={gesture}>
          <View
            className="flex-1"
            style={{ paddingHorizontal: grid.margin, paddingBottom: insets.bottom + CELL * 3 }}
          >
            {recap === null ? (
              <View className="flex-1 justify-center">
                <Text className="font-sans text-title3 text-on-recap">
                  {strings.recap.unavailable}
                </Text>
              </View>
            ) : recap !== undefined && slide !== undefined ? (
              // A new key replays the slide's entrance.
              <View key={`${index}-${restarts}`} className="flex-1">
                <Slide recap={recap} slide={slide} />
              </View>
            ) : (
              <View
                accessible
                accessibilityLabel={strings.recap.loading}
                accessibilityState={{ busy: true }}
              />
            )}
          </View>
        </GestureDetector>
      </Animated.View>
      {sharing && recap !== null && recap !== undefined && slide !== undefined && (
        <RecapSharePreview
          title={recapTitle(recap.period, strings)}
          colour={backdrop}
          onClose={closeShare}
        >
          <Slide recap={recap} slide={slide} />
        </RecapSharePreview>
      )}
    </View>
  );
}
