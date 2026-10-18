import { IconSearch } from "@tabler/icons-react-native";
import {
  heldTracks,
  inLibraryUnlessHeld,
  type SearchKind,
  type YtPick,
  ytSectionToggle,
  ytSectionView,
} from "@wave/core";
import {
  type ComponentRef,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import Animated, { LayoutAnimationConfig, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CatalogLine } from "@/catalog/CatalogLine";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { TextButton } from "@/components/TextButton";
import { rise, riseReduced } from "@/motion/entry";
import { perfMark, useRenderCount } from "@/perf/perf";
import { clearRecentSearches, rememberSearch, useRecentSearches } from "@/search/recentSearches";
import type { SongRow } from "@/library/LibraryStore";
import type { NativeYtSong } from "@/native/waveYtMusic";
import {
  listedTrackItem,
  trackItemKey,
  tracksTarget,
  type TrackItem,
} from "@/playback/actionTargets";
import {
  noLibraryResultsRow,
  RESULT_LIMIT,
  resultRows,
  songResults,
  ytFooterRows,
} from "@/search/rows";
import { useSearchRequests } from "@/search/queryRequest";
import { useYtMusicSection } from "@/search/ytMusicSearch";
import { useSearchFieldFocus } from "@/search/fieldFocus";
import { SearchField } from "@/search/SearchField";
import { SearchFieldRow } from "@/search/SearchFieldRow";
import { useSearchIndex } from "@/search/searchIndex";
import { useTopArtistSongs } from "@/search/topArtistSongs";
import { SearchResultsList } from "@/search/SearchResultsList";
import { useListSelection } from "@/selection/useListSelection";
import { useLineToggle } from "@/ytmusic/OnlineToggle";
import { useHeldSongs, useSongsInPlace } from "@/ytmusic/songsInPlace";

const NO_KINDS: ReadonlySet<SearchKind> = new Set();
const NO_YT_SONGS: readonly NativeYtSong[] = [];
const NO_TRACKS: ReadonlySet<number> = new Set();

const trackId = (song: SongRow): number => song.id;

function RecentSearches({ onPick }: { onPick: (query: string) => void }) {
  const recent = useRecentSearches();
  const bottom = useChromeInset();
  if (recent.length === 0) {
    return (
      <EmptyState
        icon={IconSearch}
        title="Search your library"
        message="Find songs, albums, artists, genres and playlists."
      />
    );
  }
  return (
    <ScrollView
      className="flex-1"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottom }}
    >
      <View className="flex-row items-center justify-between" style={{ paddingTop: CELL }}>
        <CatalogLine>Recent searches</CatalogLine>
        <TextButton label="Clear" onPress={clearRecentSearches} />
      </View>
      <Hairline />
      {recent.map((query) => (
        <EntryRow key={query} label={query} onPress={() => onPick(query)} />
      ))}
    </ScrollView>
  );
}

/**
 * The Search tab: results update as you type, grouped by type under a top
 * result. Typing searches the library only; Online on the Library | Online
 * toggle at the end of the field's row (or a query the library has nothing
 * for) merges YT Music's songs, artists and albums in, and Library hides them
 * again. With nothing typed it shows the recent searches.
 * Tapping the tab raises the keyboard; leaving it puts the keyboard away.
 * Switching between recents and results rises the new content in.
 */
export default function SearchScreen() {
  useRenderCount("SearchScreen");
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<SearchKind>>(NO_KINDS);
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  const reduceMotion = useReducedMotion();
  // The tab's tap raises the keyboard; the Library is read only once it has.
  const focus = useSearchFieldFocus(field);

  const library = useSearchIndex(focus.libraryWanted || query !== "");
  const index = library?.index ?? null;
  // The field updates on every keystroke; results follow as soon as they're ready.
  const deferredQuery = useDeferredValue(query);
  // YT Music's songs shown for this query keep their rows while their downloads finish, until
  // the query changes or the tab is left (`useSongsInPlace`). The Library's results leave
  // those files out, so they show once, and neither take the top result nor end YT Music's
  // results the Library had nothing for.
  const find = library?.find ?? null;
  const holding = useHeldSongs(deferredQuery);
  const downloads = useMemo(
    () => (find === null ? NO_TRACKS : heldTracks(holding.held, find, trackId)),
    [holding.held, find],
  );
  const results = useMemo(
    () =>
      index?.search(deferredQuery, {
        limit: RESULT_LIMIT,
        skip:
          downloads.size === 0
            ? undefined
            : (hit) => hit.kind === "song" && downloads.has(hit.song.id),
      }) ?? null,
    [index, deferredQuery, downloads],
  );
  const libraryEmpty = results !== null && results.groups.length === 0;
  // YT Music is asked once Online is picked on the toggle beside the field, or on
  // its own when the library has nothing, or as you type with Search online set to
  // Always (the toggle's long press chooses it); it answers on its own time, and its
  // songs, artists and albums the library doesn't have join the library's.
  // Until the library is ready, nothing is asked.
  const [ytSection, pickYtSection] = useYtMusicSection(deferredQuery, !libraryEmpty);
  // Each tap on Online, so a top artist whose page couldn't be read is tried again.
  const [onlineTaps, setOnlineTaps] = useState(0);
  const pickYt = useCallback(
    (pick: YtPick) => {
      if (pick === "online") setOnlineTaps((taps) => taps + 1);
      pickYtSection(pick);
    },
    [pickYtSection],
  );
  const toggle = useLineToggle(ytSectionToggle(ytSection), pickYt);
  const inLibrary = library?.library;
  const ytView = useMemo(
    () =>
      inLibrary === undefined
        ? null
        : ytSectionView(ytSection, {
            ...inLibrary,
            hasSong: inLibraryUnlessHeld(holding.held, inLibrary.hasSong),
          }),
    [ytSection, inLibrary, holding.held],
  );
  const placed = useSongsInPlace(holding, ytView?.songs ?? NO_YT_SONGS, find);
  // A Library artist on top, with Online, counts the songs their online page adds.
  const topArtist = results?.top?.kind === "artist" ? results.top.artist : null;
  const topArtistSongs = useTopArtistSongs(
    ytSection,
    topArtist,
    inLibrary?.hasSong ?? null,
    onlineTaps,
  );
  const rows = useMemo(() => {
    if (results === null) return [];
    const ytFound =
      ytView === null ? 0 : ytView.songs.length + ytView.artists.length + ytView.albums.length;
    const ours =
      libraryEmpty && ytFound === 0
        ? [noLibraryResultsRow(deferredQuery)]
        : resultRows(results, expanded, ytView, placed, topArtistSongs);
    return [...ours, ...ytFooterRows(ytView)];
  }, [results, libraryEmpty, deferredQuery, expanded, ytView, placed, topArtistSongs]);

  // Song results can be selected. The selection lives here, not in the list,
  // so a new query (or none matching) keeps it: checked songs that drop out of
  // the results stay checked, found again among every song shown since.
  const songs = useMemo(
    (): TrackItem[] => [
      ...(results === null ? [] : songResults(results).map((song) => ({ song }))),
      ...placed.songs.map(listedTrackItem),
    ],
    [results, placed.songs],
  );
  const [seen] = useState(() => new Map<string, TrackItem>());
  for (const song of songs) seen.set(trackItemKey(song), song);
  const lookup = useCallback((key: string) => seen.get(key), [seen]);
  const selection = useListSelection({
    items: songs,
    keyOf: trackItemKey,
    target: tracksTarget,
    lookup,
  });

  const changeQuery = useCallback((text: string) => {
    perfMark("search.typed", text);
    setQuery(text);
    if (text.trim() === "") setExpanded(NO_KINDS);
  }, []);
  const remember = useCallback(() => rememberSearch(query), [query]);
  const pickRecent = useCallback((recent: string) => {
    setQuery(recent);
    rememberSearch(recent);
  }, []);
  // Opened with a query (an unavailable playlist entry's Search): it searches for it.
  useSearchRequests(pickRecent);
  const showAll = useCallback(
    (kind: SearchKind) => setExpanded((kinds) => new Set(kinds).add(kind)),
    [],
  );

  // The release runner's typing response: the results for what was typed, on screen.
  useEffect(() => {
    if (results === null || deferredQuery !== query) return undefined;
    const frame = requestAnimationFrame(() => perfMark("search.results", deferredQuery));
    return () => cancelAnimationFrame(frame);
  }, [results, deferredQuery, query]);

  // What's shown; a change of it rises in. Results and no results count as
  // one, so refining a query never animates or remounts the list.
  const content = query.trim() === "" ? "recents" : index === null ? "preparing" : "results";
  // With YT Music on, its results (or its quiet line) show when the library has nothing.
  const noResults = libraryEmpty && ytView === null && deferredQuery === query;
  return (
    <View className="flex-1 bg-background">
      <View style={{ paddingTop: insets.top + 16, paddingHorizontal: grid.margin, gap: 16 }}>
        <Text
          accessibilityRole="header"
          className="font-sans text-large-title font-light text-foreground"
          style={{ letterSpacing: -0.6 }}
        >
          Search
        </Text>
        <SearchFieldRow
          toggle={toggle}
          field={
            <SearchField
              ref={field}
              value={query}
              onChange={changeQuery}
              onSubmit={remember}
              onLayout={focus.onLayout}
              onFocusChange={focus.onFocusChange}
            />
          }
        />
      </View>
      {/* Only a change of kind rises in; the screen's first content doesn't. */}
      <LayoutAnimationConfig skipEntering>
        <Animated.View
          key={content}
          entering={reduceMotion ? riseReduced : rise}
          style={{ flex: 1 }}
        >
          {content === "recents" ? (
            <RecentSearches onPick={pickRecent} />
          ) : content === "preparing" ? (
            <Text
              className="font-sans text-subheadline text-secondary"
              style={{ paddingHorizontal: grid.margin, paddingTop: CELL * 3 }}
            >
              Getting your library ready to search…
            </Text>
          ) : noResults ? (
            <EmptyState
              icon={IconSearch}
              title="No results"
              message={`Nothing in your library matches “${query.trim()}”.`}
            />
          ) : (
            <SearchResultsList
              rows={rows}
              onOpen={remember}
              onShowAll={showAll}
              integrated={ytView?.integrated ?? false}
              selection={selection}
            />
          )}
        </Animated.View>
      </LayoutAnimationConfig>
    </View>
  );
}
