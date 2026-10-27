import {
  UNAVAILABLE_ENTRY_ACTION_LABELS,
  entryDivider,
  joinArtists,
  tryAgainSearches,
  unavailableEntryActions,
  unavailableEntryView,
  unavailableSearchQuery,
  type PlaylistPlace,
  type UnavailableEntryAction,
  type UnavailableSong,
} from "@wave/core";
import { useMemo } from "react";
import { Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { CardHeading } from "@/overlay/CardHeading";
import { showError } from "@/overlay/alert";
import { useOverlayFlow } from "@/overlay/flow";
import { MenuRow } from "@/overlay/MenuRow";
import { openOverlay } from "@/overlay/overlay";
import { showToast } from "@/overlay/toast";
import { useSlideToChoose } from "@/overlay/useSlideToChoose";
import { openSearch } from "@/search/queryRequest";
import { useTabBar } from "@/settings/tabBar";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import type { PlaylistEntryRow } from "./LibraryStore";
import { removePlaylistItems } from "./playlists";
import { tryAgainUnavailable, useTryingAgain } from "./tryAgainUnavailable";

/** Tapping an unavailable entry says why it doesn't play (Core's `unavailableEntryView`). */
export const explainUnavailable = (song: UnavailableSong): void => {
  void showToast(unavailableEntryView(song).notice);
};

/**
 * Opens an unavailable entry's long-press menu next to its row: Remove from
 * Playlist, and Search while Search is on the tab bar, which opens it with
 * the song's title and main artist (Core's `unavailableEntryActions`,
 * `unavailableSearchQuery`).
 */
export const openUnavailableEntryActions = (
  song: UnavailableSong,
  playlistItem: PlaylistPlace,
): void => {
  openOverlay({
    label: song.title,
    anchor: pressedRect(),
    render: (close) => (
      <UnavailableEntryMenu song={song} playlistItem={playlistItem} close={close} />
    ),
  });
};

const run = (
  action: UnavailableEntryAction,
  song: UnavailableSong,
  playlistItem: PlaylistPlace,
): void => {
  switch (action) {
    case "removeFromPlaylist":
      removePlaylistItems(playlistItem.playlistId, [playlistItem.itemId]).catch((error: unknown) =>
        showError("Couldn't remove the song", error),
      );
      return;
    case "search":
      openSearch(unavailableSearchQuery(song));
      return;
  }
};

/** The menu card: the song as its row shows it, then its entries. */
function UnavailableEntryMenu({
  song,
  playlistItem,
  close,
}: {
  song: UnavailableSong;
  playlistItem: PlaylistPlace;
  close: () => void;
}) {
  const ytMusic = useYtMusicEnabled();
  const search = useTabBar().includes("search");
  const entries = unavailableEntryActions({ search });
  const choose = (index: number) => {
    const action = entries[index];
    if (action === undefined) return;
    close();
    run(action, song, playlistItem);
  };
  const { underFinger, trackEntry, trackList } = useSlideToChoose(choose);
  const flow = useOverlayFlow();
  return (
    <>
      <CardHeading>
        <View className="opacity-45">
          <Artwork uri={ytMusic ? (song.artworkUrl ?? undefined) : undefined} size={CELL * 5} />
        </View>
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {song.title}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {joinArtists(song.artists) || unavailableEntryView(song).line}
          </Text>
        </View>
      </CardHeading>
      <CardEntries listRef={trackList}>
        {entries.map((action, index) => (
          <View key={action} ref={trackEntry(index)} collapsable={false}>
            <MenuRow
              action={action}
              label={UNAVAILABLE_ENTRY_ACTION_LABELS[action]}
              onPress={() => choose(index)}
              divider={entryDivider(index, entries.length, flow)}
              highlighted={index === underFinger}
            />
          </View>
        ))}
      </CardEntries>
    </>
  );
}

/**
 * Try Again under a playlist's count line, while YT Music is on and it has
 * unavailable entries that can be searched again (Core's `tryAgainSearches`;
 * never a local file with no artist): it searches them once more, and
 * reads "Searching…", not tappable, until it ends.
 */
export function UnavailableTryAgain({
  playlistId,
  items,
}: {
  playlistId: number;
  items: readonly PlaylistEntryRow[] | undefined;
}) {
  const ytMusic = useYtMusicEnabled();
  const trying = useTryingAgain(playlistId);
  const searchable = useMemo(
    () => items !== undefined && tryAgainSearches(items).length > 0,
    [items],
  );
  if (!ytMusic || !(searchable || trying)) return null;
  return (
    <View className="flex-row items-center">
      <TextButton
        label={trying ? "Searching…" : "Try Again"}
        disabled={trying}
        onPress={() => {
          if (items !== undefined) tryAgainUnavailable(playlistId, items);
        }}
      />
    </View>
  );
}
