import { LegendList } from "@legendapp/list/react-native";
import { followSearchLine, listMounts, type FollowedArtist } from "@wave/core";
import { memo, type ReactElement, useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { useFollowArtistSearch } from "@/library/followArtistSearch";
import { useFollows } from "@/library/follows";
import { openFollowedArtist } from "@/library/openFollowedArtist";
import { useRenderCost } from "@/lib/renderCost";
import { useScreenContent } from "@/lib/screenTiming";
import { useStagedCount } from "@/lib/stagedCount";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { useListScrollable } from "@/motion/heldTouch";
import { showError } from "@/overlay/alert";
import { SearchField } from "@/search/SearchField";
import { FollowCountryRow } from "@/settings/FollowCountryRow";
import { FollowArtistRow, FollowIconLegend } from "@/settings/FollowLevelIcons";
import { FollowSuggestions } from "@/settings/FollowSuggestions";
import { setFollowedArtistsEnabled, useFollowedArtistsEnabled } from "@/settings/followedArtists";
import { SECTION_GAP, SettingsEditorScreen } from "@/settings/SettingsPage";

const NO_FOLLOWS: readonly FollowedArtist[] = [];

/** Follow rows one frame mounts within its budget (about 6 ms each on the emulator). */
const ROWS_PER_FRAME = 3;

const openArtist = (artist: Parameters<typeof openFollowedArtist>[0]) => () =>
  void openFollowedArtist(artist).catch((error) =>
    showError(currentLocalisation().strings.library.couldntOpenArtist, error),
  );

/** A followed artist's row; it draws again only when its own follow changes. */
const FollowedArtistItem = memo(function FollowedArtistItem({
  follow,
}: {
  follow: FollowedArtist;
}) {
  return (
    <FollowArtistRow
      artist={follow}
      image={{ name: follow.name, thumbPath: null, artworkPath: null }}
      follow={follow}
      onOpen={openArtist(follow)}
    />
  );
});

const keyOf = (follow: FollowedArtist): string => follow.key;
const renderItem = ({ item }: { item: FollowedArtist }) => <FollowedArtistItem follow={item} />;

/**
 * The follows under [header], given to the list a few rows a frame until the
 * screen is filled. Only this list renders again on those frames, and the
 * header element it passes on stays the same, so the header doesn't.
 */
function FollowList({
  follows,
  header,
}: {
  follows: readonly FollowedArtist[];
  header: ReactElement;
}) {
  const scrollable = useListScrollable();
  const { height } = useWindowDimensions();
  const mounted = useStagedCount(
    listMounts({
      count: follows.length,
      perFrame: ROWS_PER_FRAME,
      screen: Math.ceil(height / grid.row),
    }),
  );
  return (
    <LegendList
      className="flex-1"
      data={mounted < follows.length ? follows.slice(0, mounted) : follows}
      keyExtractor={keyOf}
      renderItem={renderItem}
      estimatedItemSize={grid.row}
      recycleItems
      scrollEnabled={scrollable}
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: SECTION_GAP }}
      ListHeaderComponent={header}
    />
  );
}

/**
 * Settings › Followed artists: the switch and the country, the icons' legend,
 * a search for artists to follow with suggestions under it, then every follow.
 * The follows are a virtualized list (#1442): a page holding hundreds of them
 * mounts only the rows on screen, a few a frame until the screen is filled.
 */
export default function FollowedArtistsSettingsScreen() {
  useRenderCost("FollowedArtistsScreen");
  const { strings } = useLocalisation();
  const searchStrings = strings.followArtistSearch;
  const enabled = useFollowedArtistsEnabled();
  const follows = useFollows();
  const [query, setQuery] = useState("");
  const { results, failed, pending } = useFollowArtistSearch(query, enabled);
  const searching = query.trim() !== "";
  const searchLine = followSearchLine(
    { query, pending, failed, results: results.length },
    searchStrings,
  );
  useScreenContent(true);
  const followed = searching ? new Map(follows.map((follow) => [follow.key, follow])) : null;
  const header = (
    <View style={{ gap: SECTION_GAP }}>
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
      <FollowIconLegend followsAtShows={follows.some((follow) => follow.level === "shows")} />
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
              follow={followed?.get(artist.key) ?? null}
              onOpen={openArtist(artist)}
            />
          ))}
        {searchLine !== null && (
          <Text className="py-3 font-sans text-footnote text-secondary">{searchLine}</Text>
        )}
        <FollowSuggestions enabled={enabled} hidden={searching} follows={follows} />
        {!searching && follows.length === 0 && (
          <Text className="py-3 font-sans text-body text-secondary">
            {strings.settings.youArentFollowingAnyArtistsYet}
          </Text>
        )}
      </View>
    </View>
  );
  return (
    <SettingsEditorScreen page="followedArtists">
      <FollowList follows={searching ? NO_FOLLOWS : follows} header={header} />
    </SettingsEditorScreen>
  );
}
