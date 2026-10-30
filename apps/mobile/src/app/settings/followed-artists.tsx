import { FollowCountryRow } from "@/settings/FollowCountryRow";
import { useLocalisation } from "@/localisation/localisation";
import { useState } from "react";
import { Text, View } from "react-native";
import { ArtistImage } from "@/catalog/ArtistImage";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
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
  const searchStrings = strings.followArtistSearch;
  const enabled = useFollowedArtistsEnabled();
  const follows = useFollows();
  const [query, setQuery] = useState("");
  const { results, failed, pending } = useFollowArtistSearch(query, enabled);
  const searching = query.trim() !== "";
  useScreenContent(true);
  return (
    <SettingsPageScreen page="followedArtists">
      <View>
        <Hairline />
        <SettingsSwitch
          label={strings.settings.followedArtists}
          value={enabled}
          onValueChange={setFollowedArtistsEnabled}
        />
        <Hairline />
        <FollowCountryRow />
      </View>
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
                style={{ gap: CELL * 1.5, minHeight: grid.row }}
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
        {!searching && follows.length === 0 && (
          <Text className="py-3 font-sans text-body text-secondary">
            {strings.settings.youArentFollowingAnyArtistsYet}
          </Text>
        )}
        {!searching &&
          follows.map((artist) => (
            <View key={artist.key} className="flex-row items-center">
              <TextButton
                label={artist.name}
                tone="primary"
                className="flex-1"
                onPress={() =>
                  void openFollowedArtist(artist).catch((error) =>
                    showError(strings.library.couldntOpenArtist, error),
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
                label={strings.settings.following}
                accessibilityLabel={strings.settings.manageFollow(
                  artist.name,
                  artist.level === "shows" ? strings.shows.level : strings.shows.releases,
                )}
                onPress={() => openFollowCard(artist)}
              >
                <View className="py-2 pl-3">
                  <Text className="font-sans text-body text-accent">
                    {strings.settings.following}
                  </Text>
                  <Text className="font-sans text-footnote text-secondary">
                    {artist.level === "releases" ? strings.shows.releases : strings.shows.level}
                  </Text>
                </View>
              </TextButton>
            </View>
          ))}
      </View>
    </SettingsPageScreen>
  );
}
