import { FollowCountryRow } from "@/settings/FollowCountryRow";
import { useLocalisation } from "@/localisation/localisation";
import { useState } from "react";
import { Text, View } from "react-native";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { SearchField } from "@/search/SearchField";
import { useFollowArtistSearch } from "@/library/followArtistSearch";
import { useFollows } from "@/library/follows";
import { openFollowedArtist } from "@/library/openFollowedArtist";
import { useScreenContent } from "@/lib/screenTiming";
import { showError } from "@/overlay/alert";
import { SettingsPageScreen } from "@/settings/SettingsPage";
import { FollowArtistRow, FollowIconLegend } from "@/settings/FollowLevelIcons";
import { FollowSuggestions } from "@/settings/FollowSuggestions";
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
  const open = (artist: Parameters<typeof openFollowedArtist>[0]) => () =>
    void openFollowedArtist(artist).catch((error) =>
      showError(strings.library.couldntOpenArtist, error),
    );
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
      <FollowIconLegend />
      <View>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={searchStrings.placeholder}
          accessibilityLabel={searchStrings.placeholder}
        />
        {searching &&
          results.map((artist) => (
            <FollowArtistRow
              key={artist.key}
              artist={{ name: artist.name, deezerId: artist.deezerId }}
              image={
                artist.library ?? {
                  name: artist.name,
                  thumbPath: null,
                  artworkPath: null,
                  imageUrl: artist.imageUrl,
                }
              }
              follow={follows.find((follow) => follow.key === artist.key) ?? null}
              onOpen={open(artist)}
            />
          ))}
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
        <FollowSuggestions enabled={enabled} hidden={searching} follows={follows} />
        {!searching && follows.length === 0 && (
          <Text className="py-3 font-sans text-body text-secondary">
            {strings.settings.youArentFollowingAnyArtistsYet}
          </Text>
        )}
        {!searching &&
          follows.map((artist) => (
            <FollowArtistRow
              key={artist.key}
              artist={artist}
              image={{ name: artist.name, thumbPath: null, artworkPath: null }}
              follow={artist}
              onOpen={open(artist)}
            />
          ))}
      </View>
    </SettingsPageScreen>
  );
}
