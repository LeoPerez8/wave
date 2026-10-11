import { IconSearch } from "@tabler/icons-react-native";
import type { SearchKind } from "@wave/core";
import { useFocusEffect } from "expo-router";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CatalogLine } from "@/catalog/CatalogLine";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { TextButton } from "@/components/TextButton";
import { clearRecentSearches, rememberSearch, useRecentSearches } from "@/search/recentSearches";
import { RESULT_LIMIT, resultRows } from "@/search/rows";
import { SearchField } from "@/search/SearchField";
import { useSearchIndex } from "@/search/searchIndex";
import { SearchResultsList } from "@/search/SearchResultsList";

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
 * result. With nothing typed it shows the recent searches.
 */
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<SearchKind>>(NO_KINDS);
  const [focused, setFocused] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const index = useSearchIndex(focused || query !== "");
  // The field updates on every keystroke; results follow as soon as they're ready.
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(
    () => index?.search(deferredQuery, { limit: RESULT_LIMIT }) ?? null,
    [index, deferredQuery],
  );
  const rows = useMemo(
    () => (results === null ? [] : resultRows(results, expanded)),
    [results, expanded],
  );

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

  const typed = query.trim() !== "";
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
        <SearchField value={query} onChange={changeQuery} onSubmit={remember} />
      </View>
      {!typed ? (
        <RecentSearches onPick={pickRecent} />
      ) : index === null ? (
        <Text
          className="font-sans text-subheadline text-secondary"
          style={{ paddingHorizontal: grid.margin, paddingTop: CELL * 3 }}
        >
          Getting your library ready to search…
        </Text>
      ) : results !== null && results.groups.length === 0 && deferredQuery === query ? (
        <EmptyState
          icon={IconSearch}
          title="No results"
          message={`Nothing in your library matches “${query.trim()}”.`}
        />
      ) : (
        <SearchResultsList rows={rows} onOpen={remember} onShowAll={showAll} />
      )}
    </View>
  );
}
