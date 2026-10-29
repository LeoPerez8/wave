import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AppState, Linking, Text, View } from "react-native";
import { followFeed, formatDate, type FollowShow } from "@wave/core";
import * as Effect from "effect/Effect";
import { appRuntime } from "./runtime";
import { LibraryStore } from "./LibraryStore";
import { useFollow } from "./follows";
import { checkFollowShows } from "@/home/followShows";
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
  const [shows, setShows] = useState<readonly FollowShow[]>([]);
  useFocusEffect(
    useCallback(() => {
      if (!enabled || follow?.level !== "shows") {
        setShows([]);
        return;
      }
      const controller = new AbortController();
      const read = () =>
        appRuntime
          .runPromise(
            Effect.gen(function* () {
              const store = yield* LibraryStore;
              const cache = yield* store.followShowCache;
              return followFeed({
                follows: [follow],
                shows: cache.artists.flatMap((a) => a.shows),
                country,
                now: Date.now(),
                releases: [],
                hidden: [],
                countedPlays: [],
              }).showCards;
            }),
            { signal: controller.signal },
          )
          .then((value) => {
            if (!controller.signal.aborted) setShows(value);
          });
      void read()
        .then(() => appRuntime.runPromise(checkFollowShows(), { signal: controller.signal }))
        .then(read)
        .catch(() => {});
      const active = AppState.addEventListener("change", (state) => {
        if (state === "active") void read().catch(() => {});
      });
      // Drop passed dates even when the page remains open overnight.
      const timer = setInterval(() => {
        void read().catch(() => {});
      }, 60_000);
      return () => {
        controller.abort();
        active.remove();
        clearInterval(timer);
      };
    }, [enabled, follow, country]),
  );
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
