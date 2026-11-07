import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { useFollowCountryName } from "@/settings/followCountry";
import {
  askShowNotifications,
  showsNotificationsEnabled,
  useShowsAvailability,
} from "./showNotifications";
import { CELL } from "@/catalog/grid";
import { openWaveAccount } from "@/sync/openWaveAccount";
import { WaveNative } from "@/native/waveNative";
import { MenuChoices } from "@/overlay/MenuChoices";
import { CardHeading } from "@/overlay/CardHeading";
import { IconUserPlus, IconUserCheck } from "@tabler/icons-react-native";
import type { LastListAction } from "@/catalog/PlayShuffle";
import { followLevelEntries } from "@wave/core";
import { TextButton } from "@/components/TextButton";
import { ChoiceRow } from "@/settings/ChoiceRow";
import { showError } from "@/overlay/alert";
import { followUp, openOverlay } from "@/overlay/overlay";
import { View, Text } from "react-native";
import type { FollowTarget } from "./db/follows";
import { setArtistFollow, useFollow } from "./follows";

export const openFollowCard = (artist: FollowTarget): void => {
  openOverlay({
    label: currentLocalisation().strings.library.followArtist(artist.name),
    render: (close) => <FollowCard artist={artist} close={close} />,
  });
};
/**
 * The level card's place for shows while no Wave account is signed in (shows
 * are asked through it): what an account brings, and Sign In, which opens
 * Settings › Accounts.
 */
function ShowsSignIn({ close }: { close: () => void }) {
  const { strings } = useLocalisation();
  return (
    <TextButton
      label={strings.shows.signInForShows}
      tone="primary"
      accessibilityHint={strings.playbackText.opensTheWaveAccountInSettings}
      onPress={() => {
        close();
        openWaveAccount();
      }}
      style={{ paddingVertical: CELL }}
    >
      <View>
        <Text className="font-sans text-footnote text-secondary">
          {strings.shows.signInForShows}
        </Text>
        <Text
          className="font-sans text-footnote font-medium text-accent"
          style={{ marginTop: CELL / 2 }}
        >
          {strings.settings.signIn}
        </Text>
      </View>
    </TextButton>
  );
}
/**
 * An artist's follow levels: New music, and New music and shows while a Wave
 * account is signed in (with the invitation to sign in otherwise).
 */
function FollowCard({ artist, close }: { artist: FollowTarget; close: () => void }) {
  const follow = useFollow(artist.name);
  const { strings } = useLocalisation();
  const country = useFollowCountryName();
  const shows = useShowsAvailability();
  const [denied, setDenied] = useState(!showsNotificationsEnabled());
  useEffect(() => {
    const sub = AppState.addEventListener("change", () => setDenied(!showsNotificationsEnabled()));
    return () => sub.remove();
  }, []);
  return (
    <View>
      <Text className="mb-2 font-sans text-title3 text-foreground">{artist.name}</Text>
      {followLevelEntries(follow?.level ?? null, {
        showsAvailable: shows === "available",
        country,
        notificationsDenied: denied,
        strings,
      }).map((entry) =>
        entry.action === "unfollow" ? (
          <TextButton
            key={entry.action}
            label={entry.label}
            tone="destructive"
            onPress={() => {
              close();
              void setArtistFollow(artist, null).catch((error) =>
                showError(strings.library.couldntUnfollow, error),
              );
            }}
          />
        ) : (
          <ChoiceRow
            key={entry.action}
            label={entry.label}
            chosen={entry.checked}
            line={entry.line}
            onPress={() => {
              close();
              void (async () => {
                if (entry.action === "shows") await askShowNotifications();
                await setArtistFollow(artist, entry.action === "unfollow" ? null : entry.action);
              })().catch((error) => showError(strings.library.couldntFollow, error));
            }}
          />
        ),
      )}
      {shows === "available" && denied && (
        <TextButton
          label={strings.shows.notificationSettings}
          onPress={() => WaveNative.openShowNotificationSettings?.()}
        />
      )}
      {shows === "signIn" && <ShowsSignIn close={close} />}
    </View>
  );
}
/** Menu actions close before opening the level card. */
export const followMenuPress = (artist: FollowTarget, close: () => void): void => {
  close();
  void followUp(async () => openFollowCard(artist));
};

export const useFollowAction = (artist: FollowTarget): LastListAction => {
  const { strings } = useLocalisation();
  const follow = useFollow(artist.name);
  return {
    icon: follow === null ? IconUserPlus : IconUserCheck,
    label: follow === null ? strings.library.follow : strings.library.following,
    labels: [strings.library.follow, strings.library.following],
    accessibilityLabel: strings.library.followState(
      artist.name,
      follow === null
        ? null
        : follow.level === "shows"
          ? strings.shows.level
          : strings.shows.releases,
    ),
    onPress: () => openFollowCard(artist),
  };
};

export const openFollowActions = (artist: FollowTarget): void => {
  openOverlay({
    label: artist.name,
    render: (close) => <FollowActions artist={artist} close={close} />,
  });
};
function FollowActions({ artist, close }: { artist: FollowTarget; close: () => void }) {
  const { strings } = useLocalisation();
  const follow = useFollow(artist.name);
  return (
    <>
      <CardHeading>
        <Text className="font-sans text-body text-foreground">{artist.name}</Text>
      </CardHeading>
      <MenuChoices
        cards={[]}
        entries={[
          {
            action: "follow",
            label: follow === null ? strings.library.follow : strings.library.following,
            onPress: () => followMenuPress(artist, close),
          },
        ]}
      />
    </>
  );
}
