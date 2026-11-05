import { IconDots } from "@tabler/icons-react-native";
import { IconButton } from "@/components/IconButton";
import { restoreGraveyardItem, forgetGraveyardItems } from "@/library/playlists";
import { currentLocalisation } from "@/localisation/localisation";
import { confirmAction, showError } from "@/overlay/alert";
import { MenuChoices, type MenuChoice } from "@/overlay/MenuChoices";
import { openOverlay } from "@/overlay/overlay";
import { pressedRect } from "@/motion/pressedRect";
import { formatDate } from "@wave/core";
import { useChromeInset } from "@/chrome/chrome";
import { useLocalSearchParams } from "expo-router";
import { cloneElement, useCallback, type ReactElement } from "react";
import { View } from "react-native";
import { usePlaylistGraveyard } from "@/library/hooks";
import { parseId } from "@/library/routes";
import type { PlaylistEntryRow } from "@/library/LibraryStore";
import {
  openPlaylistEntryActions,
  playPlaylistEntries,
  playlistEntrySong,
} from "@/library/PlaylistItems";
import { explainUnavailable } from "@/library/UnavailableEntry";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useLocalisation } from "@/localisation/localisation";
import { SongList } from "@/songs/SongList";
import type { SongRowPresentation } from "@/songs/songListModel";

type Entry = PlaylistEntryRow & { readonly removedAt: number };
const EMPTY: readonly Entry[] = [];
const key = (entry: Entry) => String(entry.itemId);
const song = (entry: Entry) => playlistEntrySong(entry, false);

const run = (operation: Promise<void>, title: string) => {
  void operation.catch((error: unknown) => showError(title, error));
};

const emptyGraveyard = async (playlistId: number) => {
  const text = currentLocalisation().strings.playlists;
  if (
    await confirmAction({
      title: text.emptyGraveyardQuestion,
      message: text.emptyGraveyardMessage,
      action: { label: text.emptyGraveyard, destructive: true },
    })
  ) {
    await forgetGraveyardItems(playlistId);
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
      {items.length > 0 && (
        <View className="items-end px-4">
          <IconButton
            icon={IconDots}
            label={strings.playlists.graveyard}
            onPress={() => {
              openOverlay({
                label: strings.playlists.graveyard,
                anchor: pressedRect(),
                render: (close) => (
                  <MenuChoices
                    cards={[]}
                    entries={[
                      {
                        action: "emptyGraveyard",
                        label: strings.playlists.emptyGraveyard,
                        destructive: true,
                        onPress: () => {
                          close();
                          run(emptyGraveyard(playlistId), strings.playlists.couldntForget);
                        },
                      },
                    ]}
                  />
                ),
              });
            }}
          />
        </View>
      )}
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
        onMenu={(entry, options) => {
          const text = strings.playlists;
          const extraEntries: readonly MenuChoice[] = [
            {
              action: "restoreGraveyard",
              label: text.restore,
              onPress: () =>
                run(restoreGraveyardItem(playlistId, entry.itemId), text.couldntRestore),
            },
            {
              action: "forgetGraveyard",
              label: text.removeFromGraveyard,
              destructive: true,
              onPress: () =>
                run(forgetGraveyardItems(playlistId, entry.itemId), text.couldntForget),
            },
          ];
          openPlaylistEntryActions(entry, {
            ...options,
            extraEntries: [...(options.extraEntries ?? []), ...extraEntries],
          });
        }}
        decorateRow={decorate}
      />
    </View>
  );
}
