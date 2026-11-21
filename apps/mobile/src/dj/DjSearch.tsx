import {
  DJ_MAX_SELECTED,
  YT_SEARCH_NO_LIBRARY,
  djSeedFull,
  djSelectable,
  ytSectionView,
  type DjState,
  type DjTile,
  type YtArtistAlbum,
  type YtArtistCandidate,
} from "@wave/core";
import { useDeferredValue, useMemo, useState } from "react";
import { Keyboard, ScrollView, Text, View } from "react-native";

import { AlbumCardRow } from "@/catalog/cards/AlbumCard";
import { ArtistCardRow } from "@/catalog/cards/ArtistCard";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { TrackSkeletons } from "@/catalog/Skeletons";
import { useLocalisation } from "@/localisation/localisation";
import { SearchField } from "@/search/SearchField";
import { useSearchIndex } from "@/search/searchIndex";
import { useYtMusicSection, type YtSearchScope } from "@/search/ytMusicSearch";

import { djSearchResults, type DjSearchResult } from "./djSearchResults";

/** The most Library results of one kind the search lists. */
const LIBRARY_LIMIT = 20;

/** DJ asks YouTube Music for artists and albums as the owner types, while the phone is online. */
const SCOPE: YtSearchScope = { artistsAndAlbums: true };

const NO_YT_ARTISTS: readonly YtArtistCandidate[] = [];
const NO_YT_ALBUMS: readonly YtArtistAlbum[] = [];

/**
 * The search in DJ's grid (docs/spec.md, DJ): the Search tab's Library index
 * and YouTube Music search, limited to artists and albums. Results follow
 * the field as it's typed in, the Library's at once and YouTube Music's once
 * typing pauses (never offline or with YouTube Music off), even while the
 * Library's index loads. A tap on a result hands its tile to [onPick], which
 * adds it to the selection and returns to the grid. With the selection full ([state] holds `DJ_MAX_SELECTED` tiles),
 * a line says why and only results already selected can be tapped.
 */
export function DjSearch({
  state,
  onPick,
}: {
  /** DJ as it stands, or undefined while its grid has no tiles. */
  state: DjState | undefined;
  onPick: (tile: DjTile) => void;
}) {
  const { strings } = useLocalisation();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const library = useSearchIndex(true);
  const found = useMemo(
    () =>
      library?.index.search(deferredQuery, {
        limit: LIBRARY_LIMIT,
        skip: (hit) => hit.kind !== "artist" && hit.kind !== "album",
      }) ?? null,
    [library, deferredQuery],
  );
  // Every query is asked, whatever the Library has for it: the grid's search is for
  // someone the grid doesn't show, who is often not in the Library either.
  const [section] = useYtMusicSection(deferredQuery, true, SCOPE);
  // While the Library's index loads, YouTube Music's results show alone.
  const inLibrary = library?.library ?? YT_SEARCH_NO_LIBRARY;
  const yt = useMemo(() => ytSectionView(section, inLibrary), [section, inLibrary]);
  const results = useMemo((): DjSearchResult[] => {
    const hits = found?.groups.flatMap((group) => group.items);
    return djSearchResults(
      hits === undefined
        ? null
        : {
            artists: hits.flatMap((hit) => (hit.kind === "artist" ? [hit.artist] : [])),
            albums: hits.flatMap((hit) => (hit.kind === "album" ? [hit.album] : [])),
          },
      { artists: yt?.artists ?? NO_YT_ARTISTS, albums: yt?.albums ?? NO_YT_ALBUMS },
    );
  }, [found, yt]);
  const addable = (tile: DjTile): boolean => state === undefined || djSelectable(state, tile.key);
  const full = state !== undefined && djSeedFull(state);
  const typed = query.trim() !== "";
  const loading = yt?.loading ?? false;
  const pick = (tile: DjTile): void => {
    Keyboard.dismiss();
    onPick(tile);
  };
  return (
    <View className="flex-1">
      <View style={{ paddingHorizontal: grid.margin }}>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={strings.dj.searchPlaceholder}
          accessibilityLabel={strings.dj.search}
          autoFocus
        />
      </View>
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: CELL * 3 }}
      >
        {full && (
          <Text
            accessibilityLiveRegion="polite"
            className="font-sans text-footnote text-secondary"
            style={{ paddingTop: CELL * 2 }}
          >
            {strings.dj.searchFull(DJ_MAX_SELECTED)}
          </Text>
        )}
        {typed && library === null && (
          <Text
            accessibilityLiveRegion="polite"
            className="font-sans text-subheadline text-secondary"
            style={{ paddingTop: CELL * 3 }}
          >
            {strings.playbackText.gettingYourLibraryReadyToSearch}
          </Text>
        )}
        {results.map(({ tile, image }, at) => {
          const enabled = addable(tile);
          return (
            <View key={tile.key}>
              {results[at - 1]?.tile.kind !== tile.kind && (
                <View className="justify-end" style={{ height: CELL * 6, paddingBottom: CELL }}>
                  <CatalogLine>
                    {tile.kind === "album"
                      ? strings.playbackText.albums
                      : strings.playbackText.artists}
                  </CatalogLine>
                </View>
              )}
              <View
                style={{ opacity: enabled ? 1 : 0.4 }}
                pointerEvents={enabled ? "auto" : "none"}
                accessibilityState={{ disabled: !enabled }}
              >
                {tile.kind === "album" ? (
                  <AlbumCardRow
                    title={tile.name}
                    artist={tile.artist}
                    artworkUri={tile.cover ?? undefined}
                    onPress={() => pick(tile)}
                  />
                ) : (
                  <ArtistCardRow
                    name={tile.name}
                    artist={image ?? { name: tile.name, thumbPath: null, artworkPath: null }}
                    onPress={() => pick(tile)}
                  />
                )}
              </View>
            </View>
          );
        })}
        {loading && (
          <TrackSkeletons label={strings.playbackText.loadingOnlineResults} leading="card" />
        )}
        {typed &&
          library !== null &&
          deferredQuery === query &&
          results.length === 0 &&
          !loading && (
            <Text
              accessibilityLiveRegion="polite"
              className="font-sans text-subheadline text-secondary"
              style={{ paddingTop: CELL * 3 }}
            >
              {strings.dj.searchNoMatches}
            </Text>
          )}
      </ScrollView>
    </View>
  );
}
