import { formatDate } from "@wave/core";
import { useChromeInset } from "@/chrome/chrome";
import { useLocalSearchParams } from "expo-router";
import { cloneElement, useCallback, type ReactElement } from "react";
import { View } from "react-native";
import { usePlaylistGraveyard } from "@/library/hooks";
import { parseId } from "@/library/routes";
import type { PlaylistEntryRow } from "@/library/LibraryStore";
import { playPlaylistEntries } from "@/library/PlaylistItems";
import { explainUnavailable, openUnavailableEntryActions } from "@/library/UnavailableEntry";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useLocalisation } from "@/localisation/localisation";
import { openTrackActions, openUnsearchedActions, type MenuOptions } from "@/playback/ActionsMenu";
import { openYtSongActions } from "@/ytmusic/YtSongActions";
import { SongList } from "@/songs/SongList";
import { librarySongEntry, type SongListEntry } from "@/songs/songListSources";
import type { SongRowPresentation } from "@/songs/songListModel";

type Entry = PlaylistEntryRow & { readonly removedAt: number };
const EMPTY: readonly Entry[] = [];
const key = (entry: Entry) => String(entry.itemId);
const song = (entry: Entry): SongListEntry => {
  switch (entry.source) {
    case "library":
      return librarySongEntry(entry.track);
    case "stream":
      return { source: { kind: "ytMusic", song: entry.song } };
    case "unsearched":
      return { source: { kind: "unsearched", song: entry.song } };
    case "unavailable":
      return { source: { kind: "unavailable", song: entry.song } };
  }
};
const menu = (entry: Entry, options: MenuOptions) => {
  switch (entry.source) {
    case "library":
      openTrackActions(entry.track, options);
      break;
    case "stream":
      openYtSongActions(entry.song, options);
      break;
    case "unsearched":
      openUnsearchedActions(entry.song, options);
      break;
    case "unavailable":
      openUnavailableEntryActions(entry.song);
      break;
  }
};

export default function GraveyardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlistId = parseId(id);
  const items = usePlaylistGraveyard(playlistId) ?? EMPTY;
  const { language, strings } = useLocalisation();
  const bottom = useChromeInset();
  const context = { kind: "playlist", id: String(playlistId) } as const;
  const decorate = useCallback(
    (row: ReactElement, entry: Entry) => {
      const date = formatDate(language, entry.removedAt, {
        day: "numeric",
        month: "short",
      });
      const line = strings.playlists.removedOn(date);
      const shown = row as ReactElement<SongRowPresentation>;
      return cloneElement(shown, {
        secondLine: line,
        accessibilityLabel: `${shown.props.accessibilityLabel}, ${line}`,
      });
    },
    [language, strings],
  );
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={strings.playlists.graveyard} />
      <SongList
        data={items}
        keyExtractor={key}
        song={song}
        context={context}
        contentContainerStyle={{ paddingBottom: bottom }}
        onPlay={(entry) => {
          if (entry.source === "unavailable") explainUnavailable(entry.song);
          else playPlaylistEntries(items, items.indexOf(entry), context);
        }}
        onMenu={menu}
        decorateRow={decorate}
      />
    </View>
  );
}
