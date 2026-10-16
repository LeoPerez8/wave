import { IconStack2 } from "@tabler/icons-react-native";
import type { HomeSectionId } from "@wave/core";
import { router } from "expo-router";

import { EntryRow } from "@/catalog/EntryRow";
import { Hairline } from "@/catalog/Hairline";
import { LIBRARY_SECTIONS } from "@/catalog/sections";
import { EmptyState } from "@/components/EmptyState";
import { LargeTitleScreen } from "@/components/LargeTitleScreen";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";
import { TextButton } from "@/components/TextButton";
import { HomeSection } from "@/home/HomeSection";
import { folderPhrase } from "@/library/folderPhrase";
import {
  useHome,
  useLibraryCounts,
  useScanRoots,
  useScanState,
  useTrackCount,
} from "@/library/hooks";
import { libraryShelfTitleLongPress, useLibraryShelf } from "@/library/libraryShelf";
import { promptForMusicFolder } from "@/library/promptForMusicFolder";
import { RescanRefreshControl } from "@/library/RescanRefreshControl";
import { useRenderCount } from "@/perf/perf";
import { openLibrarySectionActions } from "@/playback/ActionsMenu";

/** The shelf under the Library's rows: Home's section [id] with Home's data, nothing while it's empty. */
function LibraryShelfSection({ id }: { id: HomeSectionId }) {
  const home = useHome();
  return home === undefined ? null : <HomeSection id={id} home={home} />;
}

export default function LibraryScreen() {
  useRenderCount("LibraryScreen");
  const scan = useScanState();
  const trackCount = useTrackCount();
  const roots = useScanRoots();
  const counts = useLibraryCounts();
  const shelf = useLibraryShelf();
  const empty = scan.status === "done" && trackCount === 0;

  return (
    <LargeTitleScreen
      title="Library"
      titleLongPress={libraryShelfTitleLongPress}
      refreshControl={<RescanRefreshControl />}
    >
      <ScanProgressBanner />
      {empty && (
        <EmptyState
          icon={IconStack2}
          title="No music found"
          message={`Wave didn't find any audio files in ${folderPhrase(roots)}. Choose the folder your music is in.`}
          action={
            <TextButton label="Choose music folder" onPress={() => void promptForMusicFolder()} />
          }
        />
      )}
      <Hairline />
      {LIBRARY_SECTIONS.map((section) => (
        <EntryRow
          key={section.slug}
          label={section.label}
          count={counts?.[section.slug]}
          onPress={() => router.push(`/library/${section.slug}`)}
          onLongPress={() => openLibrarySectionActions(section)}
        />
      ))}
      {/* The shelf picked from a long press on the title; None draws nothing and reads nothing. */}
      {shelf !== "none" && <LibraryShelfSection id={shelf} />}
    </LargeTitleScreen>
  );
}
