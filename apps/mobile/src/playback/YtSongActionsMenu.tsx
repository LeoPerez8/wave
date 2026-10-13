import {
  entryDivider,
  ITEM_ACTION_LABELS,
  ytSongCredit,
  ytSongActions,
  type YtSong,
} from "@wave/core";
import { Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";
import { useSlideToChoose } from "@/overlay/useSlideToChoose";

import { addYtToQueue, playYtNext } from "./actions";

/**
 * Opens the long-press menu for a YT Music song, next to its row: it can join
 * the queue (Core's `ytSongActions`), mixed with the Library's songs.
 */
export const openYtSongActions = (song: YtSong): void => {
  openOverlay({
    label: song.title,
    anchor: pressedRect(),
    render: (close) => <YtSongActionsMenu song={song} close={close} />,
  });
};

/** What each entry does. */
const RUN = {
  playNext: playYtNext,
  addToQueue: addYtToQueue,
} as const;

/**
 * A YT Music song's menu: the song (YouTube's cover, title, artists · album),
 * then one quiet line per entry, as the Library's menus are laid out.
 */
function YtSongActionsMenu({ song, close }: { song: YtSong; close: () => void }) {
  const entries = ytSongActions().flatMap(({ action }) => {
    if (action !== "playNext" && action !== "addToQueue") return [];
    const onPress = () => {
      close();
      void RUN[action]([song]);
    };
    return [{ action, label: ITEM_ACTION_LABELS[action], onPress }];
  });
  // The finger that long-pressed the row can slide onto an entry and lift to run it.
  const { underFinger, trackEntry, trackList } = useSlideToChoose((index) =>
    entries[index]?.onPress(),
  );
  const flow = useOverlayFlow();

  return (
    <>
      <View
        className="flex-row items-center"
        style={{ paddingBottom: CELL * 1.5, gap: CELL * 1.5 }}
      >
        <Artwork uri={song.artworkUrl ?? undefined} size={CELL * 5} />
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {song.title}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {ytSongCredit(song)}
          </Text>
        </View>
      </View>
      <Hairline />
      <CardEntries listRef={trackList}>
        {entries.map((entry, index) => (
          <View key={entry.action} ref={trackEntry(index)} collapsable={false}>
            <EntryRow
              label={entry.label}
              onPress={entry.onPress}
              divider={entryDivider(index, entries.length, flow)}
              highlighted={index === underFinger}
            />
          </View>
        ))}
      </CardEntries>
    </>
  );
}
