import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { folderParent } from "@/library/BrowseLists";
import { DetailFrame } from "@/library/DetailFrame";
import { useFolder } from "@/library/hooks";
import type { FolderDetail } from "@/library/LibraryStore";
import { parseId } from "@/library/routes";
import { ListIntro, songCount, TrackList } from "@/library/TrackList";

function FolderSongs({ detail }: { detail: FolderDetail }) {
  const context = useMemo(
    () => ({ kind: "folder", id: String(detail.folder.id) }) as const,
    [detail.folder.id],
  );
  const parent = folderParent(detail.folder.path);
  const count = songCount(detail.songs.length);
  return (
    <TrackList
      songs={detail.songs}
      context={context}
      header={
        <ListIntro
          line={parent === "" ? count : `${count} · ${parent}`}
          songs={detail.songs}
          context={context}
        />
      }
    />
  );
}

/** A folder: its songs in file-name order, the way a file manager lists them. */
export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useFolder(parseId(id));
  return (
    <DetailFrame detail={detail} noun="folder" title={(folder) => folder.folder.name}>
      {(folder) => <FolderSongs detail={folder} />}
    </DetailFrame>
  );
}
