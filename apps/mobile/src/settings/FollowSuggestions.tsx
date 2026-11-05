import { FOLLOW_SUGGESTIONS_PAGE, followSuggestions, type FollowSuggestion } from "@wave/core";
import { useState } from "react";
import { Text, View } from "react-native";

import type { PlayedArtist } from "@/library/db/playedEntities";
import { useFollowSuggestionPlayed } from "@/library/followSuggestions";
import { useFollows, useFollowsRead } from "@/library/follows";
import { openFollowedArtist } from "@/library/openFollowedArtist";
import { useLocalisation } from "@/localisation/localisation";
import { showError } from "@/overlay/alert";
import { TextButton } from "@/components/TextButton";
import { usePlayedArtist } from "@/stats/PlayedEntityViews";

import { FollowArtistRow } from "./FollowLevelIcons";

function SuggestedArtistRow({ suggestion }: { suggestion: FollowSuggestion<PlayedArtist> }) {
  const { strings } = useLocalisation();
  const { image } = usePlayedArtist(suggestion.item);
  return (
    <FollowArtistRow
      artist={{ name: suggestion.name }}
      image={image}
      follow={null}
      line={suggestion.line}
      onOpen={() =>
        void openFollowedArtist({ key: suggestion.key, name: suggestion.name }).catch((error) =>
          showError(strings.library.couldntOpenArtist, error),
        )
      }
    />
  );
}

/**
 * Settings › Followed Artists' Suggested section: the artists the owner plays
 * and doesn't follow (Core's `followSuggestions`), 5 at first and 5 more per
 * Show More. Following one takes it out and the next one fills its place.
 * Nothing shows while [visible] is false or there's nothing to suggest; the
 * count starts over at 5 each time the page opens.
 */
export function FollowSuggestions({ visible }: { visible: boolean }) {
  const { strings } = useLocalisation();
  const [shown, setShown] = useState(FOLLOW_SUGGESTIONS_PAGE);
  const played = useFollowSuggestionPlayed(visible);
  const follows = useFollows();
  const followsRead = useFollowsRead();
  if (!visible || played === undefined || !followsRead) return null;
  const { suggestions, more } = followSuggestions({
    ...played,
    excluded: follows.map((follow) => follow.key),
    shown,
    strings,
  });
  if (suggestions.length === 0) return null;
  return (
    <View className="pb-3">
      <Text
        accessibilityRole="header"
        className="pt-4 pb-1 font-sans text-title3 font-semibold text-foreground"
      >
        {strings.shows.suggested}
      </Text>
      {suggestions.map((suggestion) => (
        <SuggestedArtistRow key={suggestion.key} suggestion={suggestion} />
      ))}
      {more && (
        <TextButton
          variant="plain"
          label={strings.shows.showMore}
          className="self-start py-2"
          onPress={() => setShown((count) => count + FOLLOW_SUGGESTIONS_PAGE)}
        />
      )}
    </View>
  );
}
