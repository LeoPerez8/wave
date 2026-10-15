import { IconStack2 } from "@tabler/icons-react-native";
import { router } from "expo-router";

import { EntryRow } from "@/catalog/EntryRow";
import { Hairline } from "@/catalog/Hairline";
import { LIBRARY_SECTIONS } from "@/catalog/sections";
import { EmptyState } from "@/components/EmptyState";
import { LargeTitleScreen } from "@/components/LargeTitleScreen";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";
import { TextButton } from "@/components/TextButton";
import { folderPhrase } from "@/library/folderPhrase";
import { useLibraryCounts, useScanRoots, useScanState, useTrackCount } from "@/library/hooks";
import { promptForMusicFolder } from "@/library/promptForMusicFolder";
import { RescanRefreshControl } from "@/library/RescanRefreshControl";
import { openLibrarySectionActions } from "@/playback/ActionsMenu";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { openDiscover } from "@/ytmusic/routes";

export default function LibraryScreen() {
  const scan = useScanState();
  const trackCount = useTrackCount();
  const roots = useScanRoots();
  const counts = useLibraryCounts();
  const ytMusic = useYtMusicEnabled();
  const empty = scan.status === "done" && trackCount === 0;

  return (
    <LargeTitleScreen title="Library" refreshControl={<RescanRefreshControl />}>
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
      {/* YouTube Music's recommendations; gone while YT Music is off. */}
      {ytMusic && <EntryRow label="Discover" onPress={openDiscover} />}
    </LargeTitleScreen>
  );
}
