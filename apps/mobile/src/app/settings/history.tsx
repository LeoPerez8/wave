import { LegendList } from "@legendapp/list/react-native";
import { listeningHistoryDays } from "@wave/core";
import { memo, useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { grid, CELL } from "@/catalog/grid";
import { TrackRow } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { PlainTextButton } from "@/components/PlainTextButton";
import type { ListeningHistoryRow } from "@/library/db/listeningHistory";
import { toTrackSummary } from "@/library/TrackList";
import { useListeningHistory } from "@/library/useListeningHistory";
import { fileUri } from "@/lib/fileUri";
import { useScreenContent } from "@/lib/screenTiming";
import { openTrackActions } from "@/playback/ActionsMenu";
import { playSongs } from "@/playback/actions";
import { SettingsEditorScreen } from "@/settings/SettingsPage";

type Row =
  | { readonly kind: "day"; readonly key: string; readonly title: string }
  | { readonly kind: "play"; readonly key: string; readonly play: ListeningHistoryRow };

const HistorySong = memo(function HistorySong({ play }: { play: ListeningHistoryRow }) {
  const { snapshot, song } = play;
  const time = new Date(play.startedAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <TrackRow
      track={{
        ...(song === null ? { id: `history:${play.id}`, durationMs: null } : toTrackSummary(song)),
        title: snapshot.title,
        artist: snapshot.artist,
        artworkUri: fileUri(snapshot.thumbPath ?? snapshot.artworkPath),
      }}
      leading="artwork"
      trailingLabel={time}
      unavailable={song === null}
      disabled={song === null}
      onPress={() => {
        if (song !== null) void playSongs([song], 0, { kind: "history", id: null });
      }}
      onLongPress={song === null ? undefined : () => openTrackActions(song)}
    />
  );
});

/** Counted Library plays, including saved rows for songs that have since left. */
export default function ListeningHistoryScreen() {
  const { rows: plays, loading, error, loadMore, refresh } = useListeningHistory();
  useScreenContent(!loading || plays.length > 0);
  const bottom = useChromeInset();
  const rows = useMemo(
    () =>
      listeningHistoryDays(plays).flatMap<Row>((day) => [
        { kind: "day", key: `day:${day.key}`, title: day.title },
        ...day.plays.map((play): Row => ({ kind: "play", key: `play:${play.id}`, play })),
      ]),
    [plays],
  );

  return (
    <SettingsEditorScreen page="history">
      <LegendList
        className="flex-1"
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        estimatedItemSize={grid.row}
        recycleItems
        renderItem={({ item }) =>
          item.kind === "play" ? (
            <HistorySong play={item.play} />
          ) : (
            <Text
              accessibilityRole="header"
              className="font-sans text-title3 font-semibold text-foreground"
              style={{ paddingTop: CELL * 3, paddingBottom: CELL }}
            >
              {item.title}
            </Text>
          )
        }
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottom }}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          !loading && !error ? (
            <Text className="font-sans text-body text-secondary" style={{ paddingTop: CELL * 3 }}>
              No listening history yet.
            </Text>
          ) : null
        }
        ListFooterComponent={
          <View style={{ paddingVertical: CELL * 2 }}>
            {loading && <ActivityIndicator />}
            {error && (
              <>
                <Text className="font-sans text-body text-secondary">
                  Couldn't load listening history.
                </Text>
                <PlainTextButton label="Try again" onPress={refresh} />
              </>
            )}
          </View>
        }
      />
    </SettingsEditorScreen>
  );
}
