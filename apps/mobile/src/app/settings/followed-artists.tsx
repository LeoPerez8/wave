import { FollowCountryRow } from "@/settings/FollowCountryRow";
import { useFollowCountryName } from "@/settings/followCountry";
import { useLocalisation } from "@/localisation/localisation";
import { useState } from "react";
import { Text, View } from "react-native";
import { ArtistImage } from "@/catalog/ArtistImage";
import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { openFollowCard } from "@/library/FollowButton";
import { SearchField } from "@/search/SearchField";
import { useFollowArtistSearch } from "@/library/followArtistSearch";
import { useFollows } from "@/library/follows";
import { openFollowedArtist } from "@/library/openFollowedArtist";
import { useScreenContent } from "@/lib/screenTiming";
import { showError } from "@/overlay/alert";
import { SettingsPageScreen } from "@/settings/SettingsPage";
import { setFollowedArtistsEnabled, useFollowedArtistsEnabled } from "@/settings/followedArtists";

export default function FollowedArtistsSettingsScreen() {
  const { strings } = useLocalisation();
  const country = useFollowCountryName();
  const searchStrings = strings.followArtistSearch;
  const enabled = useFollowedArtistsEnabled();
  const follows = useFollows();
  const [query, setQuery] = useState("");
  const { results, failed, pending } = useFollowArtistSearch(query, enabled);
  const searching = query.trim() !== "";
  useScreenContent(true);
  return (
    <SettingsPageScreen page="followedArtists">
      <SettingsSwitch
        label="Followed artists"
        value={enabled}
        onValueChange={setFollowedArtistsEnabled}
      />
      <FollowCountryRow />
      <View>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={searchStrings.placeholder}
          accessibilityLabel={searchStrings.placeholder}
        />
        {searching &&
          results.map((artist) => {
            const following = follows.some((follow) => follow.key === artist.key);
            const label = following ? searchStrings.following : searchStrings.follow;
            return (
              <View
                key={artist.key}
                className="flex-row items-center"
                style={{ gap: CELL * 1.5, minHeight: CELL * 8 }}
              >
                <ArtistImage
                  artist={
                    artist.library ?? {
                      name: artist.name,
                      thumbPath: null,
                      artworkPath: null,
                      imageUrl: artist.imageUrl,
                    }
                  }
                  size={CELL * 5}
                />
                <Text numberOfLines={1} className="flex-1 font-sans text-body text-foreground">
                  {artist.name}
                </Text>
                <TextButton
                  label={label}
                  accessibilityLabel={`${artist.name}, ${label}`}
                  onPress={() => openFollowCard({ name: artist.name, deezerId: artist.deezerId })}
                />
              </View>
            );
          })}
        {searching && pending && (
          <Text className="py-3 font-sans text-footnote text-secondary">
            {searchStrings.searching}
          </Text>
        )}
        {searching && failed && (
          <Text className="py-3 font-sans text-footnote text-secondary">
            {searchStrings.unavailable}
          </Text>
        )}
        {searching && results.length === 0 && !failed && !pending && (
          <Text className="py-3 font-sans text-footnote text-secondary">{searchStrings.empty}</Text>
        )}
      </View>
      {!searching && (
        <View>
          {follows.length === 0 && (
            <Text className="font-sans text-body text-secondary">
              You aren't following any artists yet.
            </Text>
          )}
          {follows.map((artist) => (
            <View key={artist.key} className="flex-row items-center">
              <TextButton
                label={artist.name}
                tone="primary"
                className="flex-1"
                onPress={() =>
                  void openFollowedArtist(artist).catch((error) =>
                    showError("Couldn't open artist", error),
                  )
                }
              >
                <View className="flex-row items-center" style={{ gap: CELL * 1.5 }}>
                  <ArtistImage
                    artist={{ name: artist.name, thumbPath: null, artworkPath: null }}
                    size={CELL * 5}
                  />
                  <Text numberOfLines={1} className="flex-1 font-sans text-body text-foreground">
                    {artist.name}
                  </Text>
                </View>
              </TextButton>
              <TextButton
                label="Following"
                accessibilityLabel={`Manage ${artist.name}, Following, ${artist.level === "shows" ? strings.shows.level(country) : strings.shows.releases}`}
                onPress={() => openFollowCard(artist)}
              >
                <View className="py-2 pl-3">
                  <Text className="font-sans text-body text-accent">Following</Text>
                  <Text className="font-sans text-footnote text-secondary">
                    {artist.level === "releases"
                      ? strings.shows.releases
                      : strings.shows.level(country)}
                  </Text>
                </View>
              </TextButton>
            </View>
          ))}
        </View>
      )}
    </SettingsPageScreen>
  );
}
