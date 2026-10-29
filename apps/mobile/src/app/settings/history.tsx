import { useLocalisation } from "@/localisation/localisation";
import { formatTime, listeningHistoryDays, type AppLanguage } from "@wave/core";
import { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { grid, CELL } from "@/catalog/grid";
import { useChromeInset } from "@/chrome/chrome";
import { TextButton } from "@/components/TextButton";
import type { ListeningHistoryRow } from "@/library/db/listeningHistory";
import { historyArtwork } from "@/library/historyArtwork";
import { useListeningHistory } from "@/library/useListeningHistory";
import { useSightedStore } from "@/lib/screenSight";
import { useScreenContent } from "@/lib/screenTiming";
import { openTrackActions } from "@/playback/ActionsMenu";
import { unavailableStreamedVideos } from "@/playback/PlayHistory";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { openYtSongActions } from "@/ytmusic/YtSongActions";
import { playYtSongs, playSongs } from "@/playback/actions";
import { SettingsEditorScreen } from "@/settings/SettingsPage";
import { SongList } from "@/songs/SongList";
import type { SongListEntry } from "@/songs/songListSources";

const HISTORY_CONTEXT = { kind: "history", id: null } as const;

type Row =
  | { readonly kind: "day"; readonly key: string; readonly title: string }
  | { readonly kind: "play"; readonly key: string; readonly play: ListeningHistoryRow };

const rowKey = (row: Row): string => row.key;
const slotType = (row: Row): string => row.kind;
/** Day headings size themselves. */
const slotSize = (): undefined => undefined;

/** What a play can do now: replay its Library song, or its stream while that can play. */
const playable = (play: ListeningHistoryRow, ytMusic: boolean, refused: ReadonlySet<string>) =>
  play.streamedSong !== null && ytMusic && !refused.has(play.streamedSong.videoId);

/**
 * A play as the song row shows it: the title and artist it was played as,
 * its start time in place of the length, no star or playing mark. A removed
 * song is dimmed and its stream replays while it can; with neither, it does
 * nothing.
 */
const historyEntry = (
  play: ListeningHistoryRow,
  streamPlayable: boolean,
  language: AppLanguage,
): SongListEntry => {
  const { snapshot, song, streamedSong } = play;
  return {
    source: {
      kind: "history",
      id: play.id,
      trackId: song === null ? undefined : String(song.id),
      title: snapshot.title,
      artist: snapshot.artist,
      durationMs: song?.durationMs ?? null,
      explicit: song?.explicit ?? false,
      artwork: historyArtwork(play, streamPlayable),
      missing: song !== null && song.path === null,
      unavailable: song === null && !streamPlayable,
      disabled: song === null && streamedSong === null,
    },
    state: {
      playing: false,
      starred: false,
      remoteArtwork: true,
      trailingLabel: formatTime(language, play.startedAt),
    },
    // A missing song shows its download as it goes.
    facts: song === null ? undefined : { missing: song.path === null },
  };
};

/** Counted plays, including streamed songs and saved rows for songs that have since left. */
export default function ListeningHistoryScreen() {
  const { strings } = useLocalisation();
  const { language } = useLocalisation();
  const { rows: plays, loading, error, loadMore, refresh } = useListeningHistory();
  useScreenContent(!loading || plays.length > 0);
  const bottom = useChromeInset();
  // Followed once for the list: whether each removed song's stream can still play.
  const ytMusic = useYtMusicEnabled();
  const refused = useSightedStore(
    unavailableStreamedVideos.subscribe,
    unavailableStreamedVideos.get,
  );
  const streamable = (play: ListeningHistoryRow) => playable(play, ytMusic, refused);
  const rows = useMemo(
    () =>
      listeningHistoryDays(plays, undefined, language).flatMap<Row>((day) => [
        { kind: "day", key: `day:${day.key}`, title: day.title },
        ...day.plays.map((play): Row => ({ kind: "play", key: `play:${play.id}`, play })),
      ]),
    [plays, language],
  );

  return (
    <SettingsEditorScreen page="history">
      <SongList
        className="flex-1"
        data={rows}
        keyExtractor={rowKey}
        song={(row) =>
          row.kind === "play" ? historyEntry(row.play, streamable(row.play), language) : null
        }
        context={HISTORY_CONTEXT}
        renderSlot={({ item }) =>
          item.kind === "day" ? (
            <Text
              accessibilityRole="header"
              className="font-sans text-title3 font-semibold text-foreground"
              style={{ paddingTop: CELL * 3, paddingBottom: CELL }}
            >
              {item.title}
            </Text>
          ) : null
        }
        slotType={slotType}
        slotSize={slotSize}
        onPlay={(row) => {
          if (row.kind !== "play") return;
          const { song, streamedSong } = row.play;
          if (song !== null) void playSongs([song], 0, HISTORY_CONTEXT);
          else if (streamedSong !== null && streamable(row.play))
            void playYtSongs([streamedSong], 0, HISTORY_CONTEXT);
        }}
        onMenu={(row) => {
          if (row.kind !== "play") return;
          const { song, streamedSong } = row.play;
          if (song !== null) openTrackActions(song);
          else if (streamedSong !== null) openYtSongActions(streamedSong);
        }}
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottom }}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          !loading && !error ? (
            <Text className="font-sans text-body text-secondary" style={{ paddingTop: CELL * 3 }}>
              {strings.settings.noListeningHistoryYet}
            </Text>
          ) : null
        }
        ListFooterComponent={
          <View style={{ paddingVertical: CELL * 2 }}>
            {loading && <ActivityIndicator />}
            {error && (
              <>
                <Text className="font-sans text-body text-secondary">
                  {strings.settings.couldntLoadListeningHistory}
                </Text>
                <TextButton
                  variant="plain"
                  label={strings.settings.tryAgainText}
                  onPress={refresh}
                />
              </>
            )}
          </View>
        }
      />
    </SettingsEditorScreen>
  );
}
