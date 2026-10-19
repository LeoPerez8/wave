import {
  FIND_IN_PLAYLIST_NO_MATCH,
  FIND_IN_PLAYLIST_PLACEHOLDER,
  createFindableList,
  findInPlaylistHead,
  hasFindQuery,
  joinArtists,
  type PlaylistFindText,
} from "@wave/core";
import type { LegendListRef } from "@legendapp/list/react-native";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { SearchField } from "@/search/SearchField";

import type { SongRow } from "./LibraryStore";

/**
 * The Find in Playlist field's height: the list starts scrolled this far
 * down, so the field waits above the page header until the list is pulled
 * down, as in Apple Music.
 */
export const FIND_FIELD_HEIGHT = grid.row + CELL;

/** What finds a Library song: its title, artist and album. */
export const librarySongText = (song: SongRow): PlaylistFindText => song;

/** What finds a song credited by its artists (YT Music's, an import's): title, artists, album. */
const creditedText = (song: {
  readonly title: string;
  readonly artists: readonly string[];
  readonly album: string | null;
}): PlaylistFindText => ({
  title: song.title,
  artist: joinArtists(song.artists),
  album: song.album,
});

/**
 * What finds a playlist entry or a YT Music page's song: a Library song's
 * title, artist and album, or those its source listed.
 */
export const entryText = (
  entry:
    | { readonly source: "library"; readonly track: SongRow }
    | {
        readonly source: "stream" | "unsearched" | "unavailable";
        readonly song: Parameters<typeof creditedText>[0];
      },
): PlaylistFindText =>
  entry.source === "library" ? librarySongText(entry.track) : creditedText(entry.song);

export interface FindInList<T = unknown> {
  readonly query: string;
  readonly onChange: (query: string) => void;
  /**
   * The places in the list (in its order) of the songs the query finds, or
   * null while nothing is typed: the whole list shows, with its header.
   */
  readonly found: readonly number[] | null;
  /** The songs the list shows: all of them while nothing is typed, else those found, in order. */
  readonly shown: readonly T[];
  /** The place in the whole list of the song shown at [index], for a tap to play from. */
  readonly placeOf: (index: number) => number;
  /**
   * For the list's content container: tall enough that the field can always
   * scroll out of sight, however short the list.
   */
  readonly minHeight: number;
}

/**
 * Find in Playlist over [songs] (Core's `createFindableList`): what the
 * query finds, and the scroll position kept while it's typed. Starting a
 * query remembers where the list was ([offset]); clearing it puts the list
 * back there ([scrollTo]) once the full list is shown again. Off
 * ([findable] false), nothing is prepared and the list shows whole.
 */
export function useFindInList<T>(
  songs: readonly T[],
  describe: (song: T) => PlaylistFindText | null,
  offset: () => number,
  scrollTo: (y: number) => void,
  findable = true,
): FindInList<T> {
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const list = useMemo(
    () => createFindableList(songs, describe, findable),
    [songs, describe, findable],
  );
  const { found, songs: shown, placeOf } = useMemo(() => list.show(query), [list, query]);
  // The list's latest scroll handles, for a change made after the render that passed them.
  const scroll = useRef({ offset, scrollTo });
  useLayoutEffect(() => {
    scroll.current = { offset, scrollTo };
  });
  const saved = useRef<number | null>(null);
  const [restore, setRestore] = useState<{ readonly y: number } | null>(null);
  const current = useRef("");
  const onChange = useCallback((next: string) => {
    const was = hasFindQuery(current.current);
    const is = hasFindQuery(next);
    if (!was && is) saved.current = scroll.current.offset();
    if (was && !is && saved.current !== null) {
      setRestore({ y: saved.current });
      saved.current = null;
    }
    current.current = next;
    setQuery(next);
  }, []);
  // The full list is back on screen: return to where it was.
  useEffect(() => {
    if (restore === null) return;
    const frame = requestAnimationFrame(() => scroll.current.scrollTo(restore.y));
    return () => cancelAnimationFrame(frame);
  }, [restore]);
  return { query, onChange, found, shown, placeOf, minHeight: height + FIND_FIELD_HEIGHT };
}

/**
 * Find in Playlist over a LegendList's [songs] (Favorites, a YT Music
 * playlist). Off ([enabled] false), nothing is prepared and the list shows whole.
 */
export function useFindInLegendList<T>(
  list: RefObject<LegendListRef | null>,
  songs: readonly T[],
  describe: (song: T) => PlaylistFindText | null,
  enabled: boolean,
): FindInList<T> {
  return useFindInList(
    songs,
    describe,
    () => list.current?.getState().scroll ?? 0,
    (y) => void list.current?.scrollToOffset({ offset: y, animated: false }),
    enabled,
  );
}

/**
 * The top of a findable list: the Find in Playlist field, then the list's
 * [header] while nothing is typed, or "No songs match" when the query finds
 * nothing (Core's `findInPlaylistHead`). A list still reading its pages
 * ([allRead] false) doesn't say so yet: its skeleton rows stand for the rest.
 */
export function FindHead({
  find,
  header,
  allRead = true,
}: {
  find: FindInList;
  header: ReactNode;
  allRead?: boolean;
}) {
  const head = findInPlaylistHead(find.found, allRead);
  return (
    <>
      <FindInPlaylistField find={find} />
      {head === "header" ? header : head === "noMatch" ? <NoSongsMatch /> : null}
    </>
  );
}

/** The Find in Playlist field, at the top of a playlist's list. */
function FindInPlaylistField({ find }: { find: FindInList }) {
  return (
    <View style={{ height: FIND_FIELD_HEIGHT }}>
      <SearchField
        value={find.query}
        onChange={find.onChange}
        placeholder={FIND_IN_PLAYLIST_PLACEHOLDER}
        accessibilityLabel={FIND_IN_PLAYLIST_PLACEHOLDER}
      />
    </View>
  );
}

/** Under the field when the query finds no song. */
function NoSongsMatch() {
  return (
    <View style={{ paddingTop: CELL * 3 }}>
      <Text className="font-sans text-subheadline text-secondary">{FIND_IN_PLAYLIST_NO_MATCH}</Text>
    </View>
  );
}
