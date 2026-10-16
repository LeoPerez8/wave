import { IconSearch } from "@tabler/icons-react-native";
import { type SearchKind, ytSectionView } from "@wave/core";
import { useFocusEffect } from "expo-router";
import { type ComponentRef, useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
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
import { clearRecentSearches, rememberSearch, useRecentSearches } from "@/search/recentSearches";
import { trackItemKey, tracksTarget, type TrackItem } from "@/playback/actionTargets";
import {
  noLibraryResultsRow,
  RESULT_LIMIT,
  resultRows,
  songResults,
  ytFooterRows,
} from "@/search/rows";
import { useYtMusicSection } from "@/search/ytMusicSearch";
import { onSearchFocusRequest, takeSearchFocusRequest } from "@/search/focusRequest";
import { SearchField } from "@/search/SearchField";
import { useSearchIndex } from "@/search/searchIndex";
import { SearchResultsList } from "@/search/SearchResultsList";
import { useListSelection } from "@/selection/useListSelection";

const NO_KINDS: ReadonlySet<SearchKind> = new Set();

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
 * result. Typing searches the library only; Search YouTube Music below the
 * results (or a query the library has nothing for) merges YT Music's songs,
 * artists and albums in. With nothing typed it shows the recent searches.
 * Tapping the tab raises the keyboard; leaving it puts the keyboard away.
 * Switching between recents and results rises the new content in.
 */
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<SearchKind>>(NO_KINDS);
  const [focused, setFocused] = useState(false);
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  const reduceMotion = useReducedMotion();

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      let frame = 0;
      // A frame later, so the field is attached when the tap is what mounts it.
      const focusField = () => {
        if (!takeSearchFocusRequest()) return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => field.current?.focus());
      };
      focusField();
      const stop = onSearchFocusRequest(focusField);
      return () => {
        setFocused(false);
        stop();
        cancelAnimationFrame(frame);
        field.current?.blur();
      };
    }, []),
  );

  const library = useSearchIndex(focused || query !== "");
  const index = library?.index ?? null;
  // The field updates on every keystroke; results follow as soon as they're ready.
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(
    () => index?.search(deferredQuery, { limit: RESULT_LIMIT }) ?? null,
    [index, deferredQuery],
  );
  const libraryEmpty = results !== null && results.groups.length === 0;
  // YT Music is asked on Search YouTube Music, or on its own when the library
  // has nothing; it answers on its own time, and its songs, artists and albums
  // the library doesn't have join the library's. Until the library is ready,
  // nothing is asked.
  const [ytSection, askYt] = useYtMusicSection(deferredQuery, !libraryEmpty);
  const inLibrary = library?.library;
  const ytView = useMemo(
    () => (inLibrary === undefined ? null : ytSectionView(ytSection, inLibrary)),
    [ytSection, inLibrary],
  );
  const rows = useMemo(() => {
    if (results === null) return [];
    const ytFound =
      ytView === null ? 0 : ytView.songs.length + ytView.artists.length + ytView.albums.length;
    const ours =
      libraryEmpty && ytFound === 0
        ? [noLibraryResultsRow(deferredQuery)]
        : resultRows(results, expanded, ytView);
    return [...ours, ...ytFooterRows(ytView)];
  }, [results, libraryEmpty, deferredQuery, expanded, ytView]);

  // Song results can be selected. The selection lives here, not in the list,
  // so a new query (or none matching) keeps it: checked songs that drop out of
  // the results stay checked, found again among every song shown since.
  const songs = useMemo((): TrackItem[] => [
    ...(results === null ? [] : songResults(results).map((song) => ({ song }))),
    ...(ytView?.songs ?? []).map((ytSong) => ({ ytSong })),
  ], [results, ytView]);
  const [seen] = useState(() => new Map<string, TrackItem>());
  for (const song of songs) seen.set(trackItemKey(song), song);
  const lookup = useCallback((key: string) => seen.get(key), [seen]);
  const selection = useListSelection({ items: songs, keyOf: trackItemKey, target: tracksTarget, lookup });

  const changeQuery = useCallback((text: string) => {
    setQuery(text);
    if (text.trim() === "") setExpanded(NO_KINDS);
  }, []);
  const remember = useCallback(() => rememberSearch(query), [query]);
  const pickRecent = useCallback((recent: string) => {
    setQuery(recent);
    rememberSearch(recent);
  }, []);
  const showAll = useCallback(
    (kind: SearchKind) => setExpanded((kinds) => new Set(kinds).add(kind)),
    [],
  );

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
        <SearchField ref={field} value={query} onChange={changeQuery} onSubmit={remember} />
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
              onAskYt={askYt}
              integrated={ytView?.integrated ?? false}
              selection={selection}
            />
          )}
        </Animated.View>
      </LayoutAnimationConfig>
    </View>
  );
}
