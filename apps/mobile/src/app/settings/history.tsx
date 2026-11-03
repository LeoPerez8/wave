import { useLocalisation } from "@/localisation/localisation";
import {
  UNKNOWN_SONG_TITLE,
  catalogueOf,
  formatTime,
  hasFindQuery,
  listeningHistoryDays,
  withOpacity,
  type AppLanguage,
} from "@wave/core";
import type { LegendListRef } from "@legendapp/list/react-native";
import { IconClockPin } from "@tabler/icons-react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  cloneElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { ActivityIndicator, Keyboard, Text, View } from "react-native";

import { grid, CELL } from "@/catalog/grid";
import { useChromeInset } from "@/chrome/chrome";
import { IconButton } from "@/components/IconButton";
import { TextButton } from "@/components/TextButton";
import type { ListeningHistoryRow } from "@/library/db/listeningHistory";
import { FindFrame, FindHead, useFindInLegendList } from "@/library/FindInPlaylist";
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
import type { SongRowActions } from "@/songs/SongRow";
import type { SongListEntry } from "@/songs/songListSources";
import { useThemeColor } from "@/theme/useThemeColor";

// The database filters history; this empty list reuses Find's field placement and scroll restoration.
const NO_LOCAL_ROWS: readonly never[] = [];
const noLocalText = () => null;

const HISTORY_CONTEXT = { kind: "history", id: null } as const;
/** How long the play Go to this moment opens at stays tinted. */
const MOMENT_TINT_MS = 3000;

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
      title:
        snapshot.title === UNKNOWN_SONG_TITLE
          ? catalogueOf(language).listeningHistory.unknownSong
          : snapshot.title,
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

/**
 * Counted plays, including streamed songs and saved rows for songs that have
 * since left. Opened with `at` (a search result's Go to this moment), the
 * full history centred on that play, above the search it came from.
 */
export default function ListeningHistoryScreen() {
  const { language, strings } = useLocalisation();
  const { at } = useLocalSearchParams<{ at?: string }>();
  const around = at === undefined || !/^\d+$/.test(at) ? undefined : Number(at);
  const list = useRef<LegendListRef>(null);
  const find = useFindInLegendList(list, NO_LOCAL_ROWS, noLocalText, true);
  const searching = hasFindQuery(find.query);
  const {
    rows: plays,
    newer,
    loading,
    error,
    loadMore,
    loadNewer,
    refresh,
  } = useListeningHistory(find.query, around);
  useScreenContent(!loading || plays.length > 0);
  const bottom = useChromeInset();
  const accent = useThemeColor("accent");
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
  // The moment's row: where the list opens, tinted for a few seconds.
  const momentIndex =
    around === undefined || searching
      ? -1
      : rows.findIndex((row) => row.kind === "play" && row.play.id === around);
  const opening = around !== undefined && loading && plays.length === 0;
  const [tinted, setTinted] = useState(around);
  useEffect(() => {
    if (tinted === undefined || opening) return;
    const timer = setTimeout(() => setTinted(undefined), MOMENT_TINT_MS);
    return () => clearTimeout(timer);
  }, [tinted, opening]);
  // One button per play and label, kept so its row isn't drawn again.
  const goToMoment = strings.listeningHistory.goToMoment;
  const [momentButtons] = useState(() => new Map<string, ReactNode>());
  const decorateRow = useCallback(
    (row: ReactElement, item: Row): ReactNode => {
      if (item.kind !== "play") return row;
      const { id } = item.play;
      if (searching) {
        const kept = `${goToMoment}:${id}`;
        let button = momentButtons.get(kept);
        if (button === undefined) {
          button = (
            <IconButton
              icon={IconClockPin}
              iconSize={20}
              strokeWidth={1.75}
              size={grid.upNextCell}
              tone="secondary"
              label={goToMoment}
              onPress={() => {
                Keyboard.dismiss();
                router.push({ pathname: "/settings/history", params: { at: String(id) } });
              }}
            />
          );
          momentButtons.set(kept, button);
        }
        return cloneElement(row as ReactElement<SongRowActions>, { accessory: button });
      }
      return id === tinted && !opening ? (
        <View
          style={{
            backgroundColor: withOpacity(accent, 0.16),
            marginHorizontal: -grid.margin,
            paddingHorizontal: grid.margin,
          }}
        >
          {row}
        </View>
      ) : (
        row
      );
    },
    [searching, momentButtons, goToMoment, tinted, opening, accent],
  );

  return (
    <SettingsEditorScreen page="history">
      <FindFrame find={find} of="history">
        {opening ? (
          <ActivityIndicator style={{ paddingVertical: CELL * 2 }} />
        ) : (
          <SongList
            ref={list}
            initialScrollOffset={find.initialOffset}
            initialScrollIndex={
              momentIndex === -1 ? undefined : { index: momentIndex, viewPosition: 0.5 }
            }
            maintainVisibleContentPosition={
              around !== undefined && !searching ? { data: true } : undefined
            }
            ListHeaderComponent={
              <FindHead
                find={find}
                of="history"
                header={null}
                allRead={false}
                lead={
                  newer && !searching ? (
                    <ActivityIndicator style={{ paddingVertical: CELL * 2 }} />
                  ) : null
                }
              />
            }
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
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
            decorateRow={decorateRow}
            extraData={tinted}
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
            contentContainerStyle={{
              paddingHorizontal: grid.margin,
              paddingBottom: bottom,
              minHeight: find.minHeight,
            }}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            onStartReached={newer && !searching ? loadNewer : undefined}
            onStartReachedThreshold={0.5}
            ListEmptyComponent={
              !loading && !error ? (
                <Text
                  className="font-sans text-body text-secondary"
                  style={{ paddingTop: CELL * 3 }}
                >
                  {hasFindQuery(find.query)
                    ? strings.library.noMatch.history
                    : strings.listeningHistory.empty}
                </Text>
              ) : null
            }
            ListFooterComponent={
              <View style={{ paddingVertical: CELL * 2 }}>
                {loading && <ActivityIndicator />}
                {error && (
                  <>
                    <Text className="font-sans text-body text-secondary">
                      {strings.listeningHistory.failed}
                    </Text>
                    <TextButton
                      variant="plain"
                      label={strings.listeningHistory.tryAgain}
                      onPress={refresh}
                    />
                  </>
                )}
              </View>
            }
          />
        )}
      </FindFrame>
    </SettingsEditorScreen>
  );
}
