import { IconMusic, IconStar, IconStarFilled } from "@tabler/icons-react-native";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { CELL } from "@/catalog/grid";
import { toggleFavorite, useIsFavorite } from "@/library/favorites";
import { useLinkRows } from "@/library/hooks";
import type { TrackDetails } from "@/library/LibraryStore";
import { openAlbum, openArtist } from "@/library/routes";
import { Press } from "@/motion/Press";
import { useCurrentTrackId } from "@/playback/hooks";
import type { PlaybackState } from "@/playback/Player";
import { useThemeColor } from "@/theme/useThemeColor";

import { closeNowPlaying } from "./sheet";

/** How far the artwork steps back while paused. */
const PAUSED_SCALE = 0.84;

const SPRING = { damping: 18, stiffness: 180, mass: 1 } as const;

/** Album art at the largest square the space allows; it shrinks back while paused. */
function NowPlayingArtwork({ uri, playing }: { uri: string | null; playing: boolean }) {
  const [box, setBox] = useState({ width: 0, height: 0 });
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
      onLayout={(event) => setBox(event.nativeEvent.layout)}
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

/** Stars the current track; in sync with every other star (rows, menus). */
function FavoriteStar({ title }: { title: string }) {
  const accent = useThemeColor("accent");
  const highlight = useThemeColor("highlight");
  const trackId = useCurrentTrackId();
  const favorite = useIsFavorite(trackId);
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

type Props = {
  item: NonNullable<PlaybackState["item"]>;
  details: TrackDetails | null;
  playing: boolean;
};

/**
 * The player: the artwork as large as it fits, then the title with the
 * favorite star beside it, the artist and the album. Artist and album open
 * their screens.
 */
export function PlayerView({ item, details, playing }: Props) {
  const title = item.title ?? "Unknown title";
  const artist = details?.artist ?? item.artist ?? "Unknown Artist";
  const album = details?.album ?? item.album ?? "Unknown Album";
  // Read ahead, so the screens open header-first.
  const links = useLinkRows(details?.albumId, details?.artistId);
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
            open={details === null ? null : () => openArtist(details.artistId, links.artist)}
            hint="Opens the artist"
            className="font-sans text-body text-secondary"
          />
          <MetaLink
            label={album}
            open={details === null ? null : () => openAlbum(details.albumId, links.album)}
            hint="Opens the album"
            className="font-sans text-body text-secondary"
          />
        </View>
        <FavoriteStar title={title} />
      </View>
    </View>
  );
}
