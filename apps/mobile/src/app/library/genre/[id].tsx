import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { DetailFrame } from "@/library/DetailFrame";
import { useGenre } from "@/library/hooks";
import type { GenreDetail } from "@/library/LibraryStore";
import { parseId } from "@/library/routes";
import { SongSortButton } from "@/library/SongSortButton";
import { useSortedSongs } from "@/library/songSort";
import { ListIntro, songCount, TrackList } from "@/library/TrackList";

function GenreSongs({ detail }: { detail: GenreDetail }) {
  const context = useMemo(
    () => ({ kind: "genre", id: String(detail.genre.id) }) as const,
    [detail.genre.id],
  );
  const { sort, songs } = useSortedSongs("genre", detail.songs);
  return (
    <TrackList
      songs={songs}
      context={context}
      sort={sort}
      header={
        <ListIntro
          line={songCount(songs.length)}
          songs={songs}
          context={context}
          sortControl={<SongSortButton kind="genre" />}
        />
      }
    />
  );
}

/** A genre: its songs in the sort chosen for genres (by title until then), with Play / Shuffle and the A–Z spine. */
export default function GenreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useGenre(parseId(id));
  return (
    <DetailFrame detail={detail} noun="genre" title={(genre) => genre.genre.name}>
      {(genre) => <GenreSongs detail={genre} />}
    </DetailFrame>
  );
}
