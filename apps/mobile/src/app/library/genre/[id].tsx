import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { DetailFrame } from "@/library/DetailFrame";
import { useGenre } from "@/library/hooks";
import type { GenreDetail } from "@/library/LibraryStore";
import { parseId } from "@/library/routes";
import { ListIntro, songCount, TrackList } from "@/library/TrackList";

function GenreSongs({ detail }: { detail: GenreDetail }) {
  const context = useMemo(
    () => ({ kind: "genre", id: String(detail.genre.id) }) as const,
    [detail.genre.id],
  );
  return (
    <TrackList
      songs={detail.songs}
      context={context}
      indexed
      header={
        <ListIntro line={songCount(detail.songs.length)} songs={detail.songs} context={context} />
      }
    />
  );
}

/** A genre: its songs by title, with Play / Shuffle and the A–Z spine. */
export default function GenreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useGenre(parseId(id));
  return (
    <DetailFrame detail={detail} noun="genre" title={(genre) => genre.genre.name}>
      {(genre) => <GenreSongs detail={genre} />}
    </DetailFrame>
  );
}
