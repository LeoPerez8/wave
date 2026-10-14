import { IconMusic, IconStar, IconStarFilled } from "@tabler/icons-react-native";
import { artistLink, parseTrackId } from "@wave/core";
import { Image } from "expo-image";
import { usePathname } from "expo-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { CELL } from "@/catalog/grid";
import { followArtistLink, followStreamedArtistLink } from "@/library/ArtistChoice";
import { toggleFavorite, useIsFavorite } from "@/library/favorites";
import { useLinkRows } from "@/library/hooks";
import type { TrackDetails } from "@/library/LibraryStore";
import { openAlbum } from "@/library/routes";
import { Press } from "@/motion/Press";
import { useCurrentTrackId } from "@/playback/hooks";
import { playbackState, type PlaybackState } from "@/playback/Player";
import { queueTracks, type QueueTrack } from "@/playback/queueTracks";
import { useThemeColor } from "@/theme/useThemeColor";
import { useStreamedArtistLink } from "@/ytmusic/streamedArtist";

import { closeNowPlaying, useNowPlayingShown } from "./sheet";

/** How far the artwork steps back while paused. */
const PAUSED_SCALE = 0.84;

const SPRING = { damping: 18, stiffness: 180, mass: 1 } as const;

/**
 * The artwork's space as last measured, so the player view coming back (from
 * the Queue or Lyrics) draws the artwork at its size straight away.
 */
let lastBox = { width: 0, height: 0 };

/** Album art at the largest square the space allows; it shrinks back while paused. */
function NowPlayingArtwork({ uri, playing }: { uri: string | null; playing: boolean }) {
  const [box, setBox] = useState(lastBox);
  const reduceMotion = useReducedMotion();
  const fill = useThemeColor("fill");
  const tertiary = useThemeColor("tertiary");
  const scale = useSharedValue(playing ? 1 : PAUSED_SCALE);

  useEffect(() => {
    const to = playing ? 1 : PAUSED_SCALE;
    scale.set(reduceMotion ? to : withSpring(to, SPRING));
  }, [playing, reduceMotion, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const size = Math.max(0, Math.min(box.width, box.height));

  return (
    <View
      className="flex-1 items-center justify-center"
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        lastBox = { width, height };
        setBox(lastBox);
      }}
    >
      <Animated.View style={[{ width: size, height: size, backgroundColor: fill }, style]}>
        {uri === null ? (
          <View className="flex-1 items-center justify-center">
            <IconMusic size={size / 4} color={tertiary} strokeWidth={1.25} />
          </View>
        ) : (
          <Image
            source={{ uri }}
            style={{ width: size, height: size }}
            contentFit="cover"
            transition={240}
            accessibilityIgnoresInvertColors
          />
        )}
      </Animated.View>
    </View>
  );
}

type LinkProps = {
  label: string;
  /** Opens the screen; plain text until the library has answered. */
  open: (() => void) | null;
  hint: string;
  className: string;
};

/** A line of metadata that opens its album or artist screen. */
function MetaLink({ label, open, hint, className }: LinkProps) {
  const text = (
    <Text numberOfLines={1} className={className}>
      {label}
    </Text>
  );
  if (open === null) return <View style={{ paddingVertical: CELL / 2 }}>{text}</View>;
  return (
    <Press
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={hint}
      // Now Playing slides away first, then the screen opens over the tabs.
      onPress={() => closeNowPlaying(open)}
      haptic="selection"
      depth={0.015}
      hitSlop={{ top: CELL, bottom: CELL }}
      style={{ paddingVertical: CELL / 2, alignSelf: "flex-start", maxWidth: "100%" }}
    >
      {text}
    </Press>
  );
}

/**
 * Stars the current track; in sync with every other star (rows, menus). A
 * YT Music song has none: favorites are the Library's.
 */
function FavoriteStar({ title }: { title: string }) {
  const accent = useThemeColor("accent");
  const highlight = useThemeColor("highlight");
  const trackId = useCurrentTrackId();
  const favorite = useIsFavorite(trackId);
  if (trackId !== null && parseTrackId(trackId)?.kind === "yt") return null;
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={favorite ? `Remove ${title} from Favorites` : `Favorite ${title}`}
      accessibilityState={{ selected: favorite, disabled: trackId === null }}
      disabled={trackId === null}
      onPress={() => {
        if (trackId !== null) void toggleFavorite(trackId);
      }}
      haptic="impact"
      depth={0.1}
      className="items-center justify-center"
      style={{ width: CELL * 6, height: CELL * 6 }}
    >
      {favorite ? (
        <IconStarFilled size={24} color={highlight} />
      ) : (
        <IconStar size={24} color={accent} strokeWidth={1.5} />
      )}
    </Press>
  );
}

/** The queue's details of the current track when it's a YT Music song (streamed), else null. */
const useStreamedTrack = (): QueueTrack | null => {
  const trackId = useCurrentTrackId();
  return useSyncExternalStore(queueTracks.subscribe, () =>
    trackId !== null && parseTrackId(trackId)?.kind === "yt"
      ? (queueTracks.get().get(trackId) ?? null)
      : null,
  );
};

type Props = {
  item: NonNullable<PlaybackState["item"]>;
  details: TrackDetails | null;
  playing: boolean;
};

/**
 * The player: the artwork as large as it fits, then the title with the
 * favorite star beside it, the artist and the album. Artist and album open
 * their screens; a streamed song's artist opens integrated (their Library
 * page, else the YouTube Music artist page) while YT Music is on.
 */
export function PlayerView({ item, details, playing }: Props) {
  const title = item.title ?? "Unknown title";
  const artist = details?.artist ?? item.artist ?? "Unknown Artist";
  const album = details?.album ?? item.album ?? "Unknown Album";
  const notice = useSyncExternalStore(playbackState.subscribe, () => playbackState.get().notice);
  // Read ahead, so the screens open header-first; only while the sheet is
  // shown, so track changes behind a closed Now Playing don't pay for it.
  const shown = useNowPlayingShown();
  // One artist opens straight away, several open the choice Go to Artist
  // offers; on an artist's page, they're left out (Core's `artistLink`).
  const here = usePathname();
  const artistTo = details === null ? undefined : artistLink(details.artistIds, here);
  const links = useLinkRows(
    shown ? details?.albumId : undefined,
    shown && artistTo?.kind === "open" ? artistTo.artistId : undefined,
  );
  // A streamed song's artists are names (Core's `streamedArtistLink`); saved before they
  // were kept, its credit stands for them.
  const streamed = useStreamedTrack();
  const streamedArtists = useMemo(
    () => (streamed === null ? null : (streamed.artists ?? [streamed.artist])),
    [streamed],
  );
  const streamedTo = useStreamedArtistLink(streamedArtists, shown);
  return (
    <View className="flex-1" style={{ gap: CELL * 4 }}>
      <NowPlayingArtwork uri={item.artworkUri} playing={playing} />
      <View className="flex-row items-center" style={{ gap: CELL }}>
        <View className="flex-1">
          <Text
            numberOfLines={1}
            accessibilityRole="header"
            className="font-sans text-title3 font-medium text-foreground"
          >
            {title}
          </Text>
          <MetaLink
            label={artist}
            open={
              details !== null
                ? () => {
                    // The only artist is the page under Now Playing: closing shows it.
                    if (artistTo !== undefined) followArtistLink(artistTo, links.artist);
                  }
                : streamedTo !== undefined
                  ? // Its only artist being the page under Now Playing, closing shows it.
                    () => followStreamedArtistLink(streamedTo)
                  : null
            }
            hint="Opens the artist"
            className="font-sans text-body text-secondary"
          />
          {notice === null ? (
            <MetaLink
              label={album}
              open={details === null ? null : () => openAlbum(details.albumId, links.album)}
              hint="Opens the album"
              className="font-sans text-body text-secondary"
            />
          ) : (
            // Why playback stopped (a YT Music song offline…), in place of the album.
            <View style={{ paddingVertical: CELL / 2 }}>
              <Text
                numberOfLines={2}
                accessibilityLiveRegion="polite"
                className="font-sans text-body text-secondary"
              >
                {notice}
              </Text>
            </View>
          )}
        </View>
        <FavoriteStar title={title} />
      </View>
    </View>
  );
}
