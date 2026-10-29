import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useLocalisation } from "@/localisation/localisation";
import { useFollowCountryName } from "@/settings/followCountry";
import {
  askShowNotifications,
  showsNotificationsEnabled,
  ticketmasterKey,
} from "./showNotifications";
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
    label: `Follow ${artist.name}`,
    render: (close) => <FollowCard artist={artist} close={close} />,
  });
};
function FollowCard({ artist, close }: { artist: FollowTarget; close: () => void }) {
  const follow = useFollow(artist.name);
  const { strings } = useLocalisation();
  const country = useFollowCountryName();
  const [denied, setDenied] = useState(!showsNotificationsEnabled());
  useEffect(() => {
    const sub = AppState.addEventListener("change", () => setDenied(!showsNotificationsEnabled()));
    return () => sub.remove();
  }, []);
  return (
    <View>
      <Text className="mb-2 font-sans text-title3 text-foreground">{artist.name}</Text>
      {followLevelEntries(follow?.level ?? null, {
        showsAvailable: ticketmasterKey !== "",
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
                showError("Couldn't unfollow artist", error),
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
              })().catch((error) => showError("Couldn't follow artist", error));
            }}
          />
        ),
      )}
      {ticketmasterKey !== "" && denied && (
        <TextButton
          label={strings.shows.notificationSettings}
          onPress={() => WaveNative.openShowNotificationSettings?.()}
        />
      )}
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
  const country = useFollowCountryName();
  const follow = useFollow(artist.name);
  return {
    icon: follow === null ? IconUserPlus : IconUserCheck,
    label: follow === null ? "Follow" : "Following",
    labels: ["Follow", "Following"],
    accessibilityLabel: `${artist.name}, ${follow === null ? "Follow" : "Following, " + (follow.level === "shows" ? strings.shows.level(country) : strings.shows.releases)}`,
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
            label: follow === null ? "Follow" : "Following",
            onPress: () => followMenuPress(artist, close),
          },
        ]}
      />
    </>
  );
}
