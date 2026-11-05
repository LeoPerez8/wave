import { IconX } from "@tabler/icons-react-native";
import {
  FOLLOW_SUGGESTIONS_PAGE,
  followSuggestions,
  type FollowedArtist,
  type FollowSuggestion,
} from "@wave/core";
import { useState } from "react";
import { Text, View } from "react-native";

import type { PlayedArtist } from "@/library/db/playedEntities";
import {
  dismissFollowSuggestion,
  undoFollowSuggestionDismissal,
  useDismissedFollowSuggestions,
} from "@/library/followSuggestionDismissals";
import { useFollowSuggestionPlayed } from "@/library/followSuggestions";
import { useFollowsRead } from "@/library/follows";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { showError } from "@/overlay/alert";
import { showToast } from "@/overlay/toast";
import { IconButton } from "@/components/IconButton";
import { TextButton } from "@/components/TextButton";
import { usePlayedArtist } from "@/stats/PlayedEntityViews";

import { FollowArtistRow } from "./FollowLevelIcons";

/** Dismisses at once; the toast's Undo puts the artist back in their place. */
const dismissWithUndo = (key: string): void => {
  const { strings } = currentLocalisation();
  void dismissFollowSuggestion(key).then(
    () =>
      void showToast(strings.shows.suggestionDismissed, {
        label: strings.shows.undo,
        run: () =>
          void undoFollowSuggestionDismissal(key).catch((error) =>
            showError(strings.library.couldntRestoreSuggestion, error),
          ),
      }),
    (error) => showError(strings.library.couldntDismissSuggestion, error),
  );
};

function SuggestedArtistRow({ suggestion }: { suggestion: FollowSuggestion<PlayedArtist> }) {
  const { strings } = useLocalisation();
  const { image, open } = usePlayedArtist(suggestion.item);
  return (
    <FollowArtistRow
      artist={{ name: suggestion.name }}
      image={image}
      follow={null}
      line={suggestion.line}
      onOpen={open}
      trailing={
        <IconButton
          icon={IconX}
          iconSize={24}
          tone="secondary"
          label={strings.shows.dismissSuggestion(suggestion.name)}
          onPress={() => dismissWithUndo(suggestion.key)}
        />
      }
    />
  );
}

/**
 * Settings › Followed Artists' Suggested section: the artists the owner plays
 * and doesn't follow (Core's `followSuggestions`), 5 at first and 5 more per
 * Show More. Following or dismissing (×, with Undo) one takes it out and the
 * next one fills its place; dismissed artists are never suggested again.
 * [follows] are the screen's followed artists. Plays are read while [enabled];
 * nothing shows while it's false, while [hidden] (a search on the page, which
 * keeps the read and the count) or when there's nothing to suggest. The count
 * starts over at 5 each time the page opens.
 */
export function FollowSuggestions({
  enabled,
  hidden,
  follows,
}: {
  enabled: boolean;
  hidden: boolean;
  follows: readonly FollowedArtist[];
}) {
  const { strings } = useLocalisation();
  const [shown, setShown] = useState(FOLLOW_SUGGESTIONS_PAGE);
  const played = useFollowSuggestionPlayed(enabled);
  const followsRead = useFollowsRead();
  const dismissed = useDismissedFollowSuggestions();
  if (!enabled || hidden || played === undefined || !followsRead || dismissed === undefined)
    return null;
  const { suggestions, more } = followSuggestions({
    ...played,
    excluded: follows.map((follow) => follow.key),
    dismissed,
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
