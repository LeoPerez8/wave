import { sortSongs } from "@wave/core";
import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { folderParent } from "@/library/BrowseLists";
import { DetailFrame } from "@/library/DetailFrame";
import { useFolder } from "@/library/hooks";
import type { FolderDetail } from "@/library/LibraryStore";
import { parseId } from "@/library/routes";
import { SongSortButton } from "@/library/SongSortButton";
import { useSongSort } from "@/library/songSort";
import { ListIntro, songCount, TrackList } from "@/library/TrackList";

function FolderSongs({ detail }: { detail: FolderDetail }) {
  const context = useMemo(
    () => ({ kind: "folder", id: String(detail.folder.id) }) as const,
    [detail.folder.id],
  );
  const sort = useSongSort("folder");
  // Play, Shuffle and rows all play this displayed order.
  const songs = useMemo(() => sortSongs(detail.songs, sort), [detail.songs, sort]);
  const parent = folderParent(detail.folder.path);
  const count = songCount(songs.length);
  return (
    <TrackList
      songs={songs}
      context={context}
      sort={sort}
      header={
        <ListIntro
          line={parent === "" ? count : `${count} · ${parent}`}
          songs={songs}
          context={context}
          sortControl={<SongSortButton kind="folder" />}
        />
      }
    />
  );
}

/**
 * A folder: its songs in the sort chosen for folders; until then by file name,
 * the way a file manager lists them.
 */
export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useFolder(parseId(id));
  return (
    <DetailFrame detail={detail} noun="folder" title={(folder) => folder.folder.name}>
      {(folder) => <FolderSongs detail={folder} />}
    </DetailFrame>
  );
}
