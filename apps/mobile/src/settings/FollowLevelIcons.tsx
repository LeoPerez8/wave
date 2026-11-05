import {
  IconDisc,
  IconDiscFilled,
  IconTicket,
  IconTicketFilled,
  IconUserMinus,
} from "@tabler/icons-react-native";
import {
  followIconLegend,
  followLevelIcons,
  type FollowedArtist,
  type FollowLevel,
  type FollowLevelIcon,
} from "@wave/core";
import type { ComponentProps, ReactNode } from "react";
import { Text, View } from "react-native";

import { ArtistImage } from "@/catalog/ArtistImage";
import { CELL, grid } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import { TextButton } from "@/components/TextButton";
import type { FollowTarget } from "@/library/db/follows";
import { restoreArtistFollow, setArtistFollow } from "@/library/follows";
import { askShowNotifications, ticketmasterKey } from "@/library/showNotifications";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { showError } from "@/overlay/alert";
import { showToast } from "@/overlay/toast";
import { useThemeColor } from "@/theme/useThemeColor";

import { useFollowCountryName } from "./followCountry";

const ICON = 24;
const glyph = (action: FollowLevelIcon["action"], filled: boolean) =>
  action === "releases"
    ? filled
      ? IconDiscFilled
      : IconDisc
    : action === "shows"
      ? filled
        ? IconTicketFilled
        : IconTicket
      : IconUserMinus;

/** What the level icons depend on: Ticketmaster's key and the Country row. */
const useIconOptions = () => {
  const { strings } = useLocalisation();
  const country = useFollowCountryName();
  return { showsAvailable: ticketmasterKey !== "", country, strings };
};

/** Follows at [level], asking for notifications before the first shows-level follow. */
const pickLevel = (artist: FollowTarget, level: FollowLevel): void => {
  void (async () => {
    if (level === "shows") await askShowNotifications();
    await setArtistFollow(artist, level);
  })().catch((error) => showError(currentLocalisation().strings.library.couldntFollow, error));
};

/** Unfollows at once; the toast's Undo brings back the same follow. */
const unfollowWithUndo = (follow: FollowedArtist): void => {
  const { strings } = currentLocalisation();
  void setArtistFollow(follow, null).then(
    () =>
      void showToast(strings.shows.unfollowed(follow.name), {
        label: strings.shows.undo,
        run: () =>
          void restoreArtistFollow(follow).catch((error) =>
            showError(strings.library.couldntFollow, error),
          ),
      }),
    (error) => showError(strings.library.couldntUnfollow, error),
  );
};

/**
 * One artist on Settings › Followed Artists: photo and name open the artist,
 * then the level icons (disc, ticket) as a group of options and, for a
 * followed artist, Unfollow. [line] and [trailing] let other sections (such
 * as suggestions) add a reason under the name and a control at the end.
 */
export function FollowArtistRow({
  artist,
  image,
  follow,
  onOpen,
  line,
  trailing,
}: {
  artist: FollowTarget;
  image: ComponentProps<typeof ArtistImage>["artist"];
  /** The artist's follow, or null when the owner doesn't follow them. */
  follow: FollowedArtist | null;
  onOpen: () => void;
  line?: string;
  trailing?: ReactNode;
}) {
  const options = useIconOptions();
  const icons = followLevelIcons(follow?.level ?? null, { artist: artist.name, ...options });
  const levels = icons.filter((icon) => icon.action !== "unfollow");
  const unfollow = icons.find((icon) => icon.action === "unfollow");
  return (
    <View className="flex-row items-center" style={{ minHeight: grid.row }}>
      <TextButton label={artist.name} tone="primary" className="flex-1" onPress={onOpen}>
        <View className="flex-row items-center" style={{ gap: CELL * 1.5 }}>
          <ArtistImage artist={image} size={CELL * 5} />
          <View className="flex-1">
            <Text numberOfLines={1} className="font-sans text-body text-foreground">
              {artist.name}
            </Text>
            {line !== undefined && (
              <Text numberOfLines={1} className="font-sans text-footnote text-secondary">
                {line}
              </Text>
            )}
          </View>
        </View>
      </TextButton>
      <View
        className="flex-row items-center"
        accessibilityRole="radiogroup"
        accessibilityLabel={artist.name}
      >
        {levels.map((icon) => (
          <IconButton
            key={icon.action}
            icon={glyph(icon.action, icon.filled)}
            iconSize={ICON}
            tone={icon.filled ? "accent" : "secondary"}
            accessibilityRole="radio"
            accessibilityLabel={icon.accessibilityLabel}
            accessibilityState={{ selected: icon.filled }}
            onPress={() => {
              if (!icon.filled && icon.action !== "unfollow") pickLevel(artist, icon.action);
            }}
          />
        ))}
      </View>
      {unfollow !== undefined && follow !== null && (
        <IconButton
          icon={IconUserMinus}
          iconSize={ICON}
          tone="destructive"
          accessibilityLabel={unfollow.accessibilityLabel}
          onPress={() => unfollowWithUndo(follow)}
        />
      )}
      {trailing}
    </View>
  );
}

/**
 * The fixed legend above the search: each icon and what it does.
 * [followsAtShows] keeps the ticket's line while a listed follow is at shows.
 */
export function FollowIconLegend({ followsAtShows }: { followsAtShows: boolean }) {
  const options = { ...useIconOptions(), followsAtShows };
  const secondary = useThemeColor("secondary");
  const destructive = useThemeColor("destructive");
  return (
    <View style={{ gap: CELL }}>
      {followIconLegend(options).map((entry) => {
        const Icon = glyph(entry.action, false);
        return (
          <View key={entry.action} className="flex-row items-center" style={{ gap: CELL * 1.5 }}>
            <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <Icon
                size={ICON}
                strokeWidth={1.5}
                color={entry.action === "unfollow" ? destructive : secondary}
              />
            </View>
            <Text className="flex-1 font-sans text-footnote text-secondary">{entry.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
