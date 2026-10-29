import { useMemo } from "react";
import { Linking, Text, View } from "react-native";
import { formatDate } from "@wave/core";
import { useFollow } from "./follows";
import { useShowCards } from "@/home/upcomingShowCards";
import { useFollowedArtistsEnabled } from "@/settings/followedArtists";
import { currentFollowCountry, useFollowCountryName } from "@/settings/followCountry";
import { TextButton } from "@/components/TextButton";
import { useLocalisation } from "@/localisation/localisation";
/** Shows in <Country>: a shows-level artist's upcoming shows, soonest first; absent with none. */
export function ArtistShows({ name }: { name: string }) {
  const follow = useFollow(name);
  const enabled = useFollowedArtistsEnabled();
  const countryName = useFollowCountryName();
  const country = currentFollowCountry();
  const { language, strings } = useLocalisation();
  const followed = useMemo(() => (follow === null ? [] : [follow]), [follow]);
  const shows = useShowCards(followed, country, enabled && follow?.level === "shows");
  const visible = shows.filter((s) => s.country === country);
  if (!enabled || follow?.level !== "shows" || visible.length === 0) return null;
  return (
    <View className="py-3">
      <Text className="font-sans text-title3 text-foreground">
        {strings.shows.shelf(countryName)}
      </Text>
      {visible.map((show) => (
        <View key={show.id} className="py-2">
          <Text className="font-sans text-body text-foreground">
            {formatDate(language, new Date(show.startsAt))}
          </Text>
          <Text className="font-sans text-footnote text-secondary">
            {show.city}, {show.venue}
          </Text>
          <TextButton
            label={strings.shows.tickets}
            accessibilityLabel={`${strings.shows.tickets}, ${show.city}, ${show.venue}`}
            onPress={() => {
              void Linking.openURL(show.ticketUrl).catch(() => {});
            }}
          />
        </View>
      ))}
    </View>
  );
}
