import { IconMusic } from "@tabler/icons-react-native";
import { View } from "react-native";

import { grid } from "@/catalog/grid";
import { EmptyState } from "@/components/EmptyState";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";
import { TextButton } from "@/components/TextButton";

import { folderPhrase } from "./folderPhrase";
import { useScanRoots, useScanState, useSongs } from "./hooks";
import { promptForMusicFolder } from "./promptForMusicFolder";
import { SongSortButton } from "./SongSortButton";
import { useSortedSongs } from "./songSort";
import { ListIntro, songCount, TrackList } from "./TrackList";

/** Tapping a song plays the whole Songs list from it. */
const SONGS_CONTEXT = { kind: "songs", id: null } as const;

/**
 * Library › Songs: every track in the sort you chose (by title until then),
 * virtualised for libraries of tens of thousands.
 */
export function SongsList() {
  const library = useSongs();
  const { sort, songs } = useSortedSongs("songs", library);
  const scan = useScanState();
  const roots = useScanRoots();

  if (songs.length === 0) {
    return (
      <View style={{ paddingHorizontal: grid.margin }}>
        <ScanProgressBanner />
        <EmptyState
          icon={IconMusic}
          title={scan.status === "scanning" ? "Looking for songs" : "No songs"}
          message={
            scan.status === "scanning"
              ? "Songs appear here as Wave finds them."
              : `Wave didn't find any songs in ${folderPhrase(roots)}.`
          }
          action={
            scan.status === "scanning" ? undefined : (
              <TextButton label="Choose music folder" onPress={() => void promptForMusicFolder()} />
            )
          }
        />
      </View>
    );
  }

  return (
    <TrackList
      songs={songs}
      context={SONGS_CONTEXT}
      sort={sort}
      header={
        <View>
          <ScanProgressBanner />
          <ListIntro
            line={songCount(songs.length)}
            songs={songs}
            context={SONGS_CONTEXT}
            sortControl={<SongSortButton kind="songs" />}
          />
        </View>
      }
    />
  );
}
