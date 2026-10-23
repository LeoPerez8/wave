import { useScreenContent } from "@/lib/screenTiming";
import { librarySongSort, type LibrarySongSort } from "@wave/core";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";

import { DetailFrame } from "@/library/DetailFrame";
import { GenreSongList, useGenreOpening } from "@/library/GenreSongList";
import type { GenreOpening, GenreRow } from "@/library/LibraryStore";
import { parseId, useKnownRow } from "@/library/routes";
import { useSongSort } from "@/library/songSort";

/** What the screen shows: the genre, and its first page once read, in the sort it was read in. */
interface Shown {
  readonly genre: GenreRow;
  /** Undefined until read; the header doesn't wait for it. */
  readonly opening: GenreOpening | undefined;
  readonly sort: LibrarySongSort;
}

/**
 * A genre: its songs in the sort chosen for genres (by title until then), with
 * Play / Shuffle and the A–Z spine. Opened from a list that knows the genre,
 * the header is there on the first frame; the first page follows from one
 * index seek, and the rest of the genre once the screen has settled (#601).
 */
export default function GenreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const genreId = parseId(id);
  const sort = librarySongSort(useSongSort("genre"));
  const read = useGenreOpening(genreId, sort);
  // Another sort's songs show until this one's first page is read, rather than skeletons.
  const [last, setLast] = useState<Shown | null>(null);
  if (read != null && read !== last?.opening) setLast({ genre: read.genre, opening: read, sort });
  const opened: Shown | null | undefined =
    read != null ? { genre: read.genre, opening: read, sort } : read === null ? null : last ?? undefined;
  useScreenContent(opened !== undefined);
  const known = useKnownRow("genre", genreId);
  const shown: Shown | null | undefined =
    opened === undefined && known !== undefined ? { genre: known, opening: undefined, sort } : opened;
  return (
    <DetailFrame detail={shown} noun="genre" title={({ genre }) => genre.name}>
      {({ genre, opening, sort: openedSort }) => (
        <GenreSongList genre={genre} opening={opening} sort={openedSort} />
      )}
    </DetailFrame>
  );
}
