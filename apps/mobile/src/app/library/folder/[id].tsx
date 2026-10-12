import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { folderParent } from "@/library/BrowseLists";
import { DetailFrame } from "@/library/DetailFrame";
import { useFolder } from "@/library/hooks";
import type { FolderRow, SongRow } from "@/library/LibraryStore";
import { parseId, useKnownRow } from "@/library/routes";
import { SongSortButton } from "@/library/SongSortButton";
import { useSortedSongs } from "@/library/songSort";
import { ListIntro, songCount, TrackList } from "@/library/TrackList";

/** What the screen shows: the folder, and its songs once they are read. */
interface Shown {
  readonly folder: FolderRow;
  /** Undefined until the songs are read; the header doesn't wait for them. */
  readonly songs: readonly SongRow[] | undefined;
}

const NO_SONGS: readonly SongRow[] = [];

function FolderSongs({ shown }: { shown: Shown }) {
  const { folder } = shown;
  const context = useMemo(() => ({ kind: "folder", id: String(folder.id) }) as const, [folder.id]);
  const { sort, songs } = useSortedSongs("folder", shown.songs ?? NO_SONGS);
  const loaded = shown.songs !== undefined;
  const parent = folderParent(folder.path);
  const count = songCount(loaded ? songs.length : folder.trackCount);
  return (
    <TrackList
      songs={songs}
      context={context}
      sort={sort}
      header={
        <ListIntro
          line={parent === "" ? count : `${count} · ${parent}`}
          songs={loaded ? songs : undefined}
          context={context}
          sortControl={<SongSortButton kind="folder" />}
        />
      }
    />
  );
}

/**
 * A folder: its songs in the sort chosen for folders; until then by file name,
 * the way a file manager lists them. Opened from a list that knows the
 * folder, the header is there on the first frame and the songs follow once read.
 */
export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const folderId = parseId(id);
  const detail = useFolder(folderId);
  const known = useKnownRow("folder", folderId);
  const shown: Shown | null | undefined =
    detail === undefined && known !== undefined ? { folder: known, songs: undefined } : detail;
  return (
    <DetailFrame detail={shown} noun="folder" title={({ folder }) => folder.name}>
      {(folder) => <FolderSongs shown={folder} />}
    </DetailFrame>
  );
}
