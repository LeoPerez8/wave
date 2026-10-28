import {
  createFindableList,
  findFieldPlacement,
  findInPlaylistHead,
  findNoMatch,
  findPlaceholder,
  findScrollOnPin,
  hasFindQuery,
  joinArtists,
  type FindableListKind,
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
import { useKeepFindVisible } from "@/settings/keepFindVisible";

import type { SongRow } from "./LibraryStore";

/**
 * The Find in Playlist field's height: the list starts scrolled this far
 * down, so the field waits above the page header until the list is pulled
 * down, as in Apple Music (unless Keep Find Field Visible pins it).
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
   * Keep Find Field Visible is on (and the list findable): the field is
   * pinned above the list (`FindFrame`), not at its top (`FindHead`).
   */
  readonly pinned: boolean;
  /**
   * The scroll the list opens at: just past the field, or its top when the
   * field is pinned. Read once, as the list opens.
   */
  readonly initialOffset: number;
  /**
   * For the list's content container: tall enough that the field can always
   * scroll out of sight, however short the list; none when it's pinned.
   */
  readonly minHeight: number | undefined;
}

/**
 * Find in Playlist over [songs] (Core's `createFindableList`): what the
 * query finds, and the scroll position kept while it's typed. Starting a
 * query remembers where the list was ([offset]); clearing it puts the list
 * back there ([scrollTo]) once the full list is shown again. Keep Find
 * Field Visible turned on or off moves the open list by the field's height,
 * so its rows stay put as the field leaves or rejoins it. Off ([findable]
 * false), nothing is prepared and the list shows whole.
 */
export function useFindInList<T>(
  songs: readonly T[],
  describe: (song: T) => PlaylistFindText | null,
  offset: () => number,
  scrollTo: (y: number) => void,
  findable = true,
): FindInList<T> {
  const { height } = useWindowDimensions();
  const pinned = useKeepFindVisible() && findable;
  const placement = findFieldPlacement({
    pinned,
    fieldHeight: FIND_FIELD_HEIGHT,
    viewportHeight: height,
  });
  const { minHeight } = placement;
  // Read once, as the list opens.
  const [initialOffset] = useState(placement.initialOffset);
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
  // The field left or rejoined the list: move it by the field, read before the list relays out.
  const placedPinned = useRef(pinned);
  useLayoutEffect(() => {
    if (placedPinned.current === pinned) return;
    placedPinned.current = pinned;
    const y = findScrollOnPin(scroll.current.offset(), FIND_FIELD_HEIGHT, pinned);
    if (saved.current !== null)
      saved.current = findScrollOnPin(saved.current, FIND_FIELD_HEIGHT, pinned);
    const frame = requestAnimationFrame(() => scroll.current.scrollTo(y));
    return () => cancelAnimationFrame(frame);
  }, [pinned]);
  return { query, onChange, found, shown, placeOf, pinned, initialOffset, minHeight };
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
 * The top of a findable list ([of]: a playlist, the Library's Songs or
 * Artists): the field ("Find in Playlist", unless it's pinned above the
 * list, see `FindFrame`), then the list's [header] while
 * nothing is typed, or "No songs match" ("No artists match") when the query
 * finds nothing (Core's `findInPlaylistHead`, `findNoMatch`). A list still
 * reading what it finds by ([allRead] false: a YT Music playlist's pages,
 * the Library's songs) doesn't say so yet. A [lead] sits under the field (first, when
 * it's pinned), whatever the query (Playlists' import line).
 */
export function FindHead({
  find,
  header,
  allRead = true,
  of = "playlist",
  lead = null,
}: {
  find: FindInList;
  header: ReactNode;
  allRead?: boolean;
  of?: FindableListKind;
  lead?: ReactNode;
}) {
  const head = findInPlaylistHead(find.found, allRead);
  return (
    <>
      {!find.pinned && <FindField find={find} of={of} />}
      {lead}
      {head === "header" ? header : head === "noMatch" ? <NoMatch of={of} /> : null}
    </>
  );
}

/**
 * A findable list's frame, filling its parent: with Keep Find Field Visible
 * on, the field ([of]) pinned above [children] (the list and what's drawn
 * over it), so the list scrolls under it; else [children] alone. [inset] is
 * the list's right padding, which an A–Z spine widens.
 */
export function FindFrame({
  find,
  of = "playlist",
  inset = grid.margin,
  children,
}: {
  find: FindInList;
  of?: FindableListKind | undefined;
  inset?: number;
  children: ReactNode;
}) {
  return (
    <View className="flex-1">
      {find.pinned && (
        <View style={{ paddingLeft: grid.margin, paddingRight: inset }}>
          <FindField find={find} of={of} />
        </View>
      )}
      {/* The same place either way: switching keeps the list mounted. */}
      <View className="flex-1">{children}</View>
    </View>
  );
}

/** The Find field, at the top of a findable list or pinned above it. */
function FindField({ find, of }: { find: FindInList; of: FindableListKind }) {
  const placeholder = findPlaceholder(of);
  return (
    <View style={{ height: FIND_FIELD_HEIGHT }}>
      <SearchField
        value={find.query}
        onChange={find.onChange}
        placeholder={placeholder}
        accessibilityLabel={placeholder}
      />
    </View>
  );
}

/** Under the field when the query finds nothing. */
function NoMatch({ of }: { of: FindableListKind }) {
  return (
    <View style={{ paddingTop: CELL * 3 }}>
      <Text className="font-sans text-subheadline text-secondary">{findNoMatch(of)}</Text>
    </View>
  );
}
