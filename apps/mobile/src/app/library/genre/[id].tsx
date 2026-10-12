import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { DetailFrame } from "@/library/DetailFrame";
import { useGenre } from "@/library/hooks";
import type { GenreRow, SongRow } from "@/library/LibraryStore";
import { parseId, useKnownRow } from "@/library/routes";
import { SongSortButton } from "@/library/SongSortButton";
import { useSortedSongs } from "@/library/songSort";
import { ListIntro, songCount, TrackList } from "@/library/TrackList";

/** What the screen shows: the genre, and its songs once they are read. */
interface Shown {
  readonly genre: GenreRow;
  /** Undefined until the songs are read; the header doesn't wait for them. */
  readonly songs: readonly SongRow[] | undefined;
}

const NO_SONGS: readonly SongRow[] = [];

function GenreSongs({ shown }: { shown: Shown }) {
  const { genre } = shown;
  const context = useMemo(() => ({ kind: "genre", id: String(genre.id) }) as const, [genre.id]);
  const { sort, songs } = useSortedSongs("genre", shown.songs ?? NO_SONGS);
  const loaded = shown.songs !== undefined;
  return (
    <TrackList
      songs={songs}
      context={context}
      sort={sort}
      header={
        <ListIntro
          line={songCount(loaded ? songs.length : genre.trackCount)}
          songs={loaded ? songs : undefined}
          context={context}
          sortControl={<SongSortButton kind="genre" />}
        />
      }
    />
  );
}

/**
 * A genre: its songs in the sort chosen for genres (by title until then), with
 * Play / Shuffle and the A–Z spine. Opened from a list that knows the genre,
 * the header is there on the first frame and the songs follow once read.
 */
export default function GenreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const genreId = parseId(id);
  const detail = useGenre(genreId);
  const known = useKnownRow("genre", genreId);
  const shown: Shown | null | undefined =
    detail === undefined && known !== undefined ? { genre: known, songs: undefined } : detail;
  return (
    <DetailFrame detail={shown} noun="genre" title={({ genre }) => genre.name}>
      {(genre) => <GenreSongs shown={genre} />}
    </DetailFrame>
  );
}
