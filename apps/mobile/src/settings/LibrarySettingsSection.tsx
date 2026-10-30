import { useLocalisation } from "@/localisation/localisation";
import { router } from "@/lib/timingRouter";
import { useState } from "react";
import { Text, View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { TextButton } from "@/components/TextButton";
import { useScanRoots, useScanStatus } from "@/library/hooks";
import { importBlackPlayerStats } from "@/library/importBlackPlayerStats";
import { setSkipVoiceNotes, startRescan } from "@/library/runtime";
import { useSkipVoiceNotes } from "@/settings/skipVoiceNotes";

/** Import BlackPlayer Stats, with what it does. */
function BlackPlayerImport() {
  const { strings } = useLocalisation();
  const [importing, setImporting] = useState(false);
  const start = () => {
    setImporting(true);
    void importBlackPlayerStats().finally(() => setImporting(false));
  };
  return (
    <>
      <View className="mt-4 items-start">
        <TextButton
          label={importing ? strings.settings.importing : strings.settings.importBlackPlayerStats}
          disabled={importing}
          onPress={start}
        />
      </View>
      <Text className="font-sans text-footnote text-secondary">
        {strings.settings.addsThePlaysInBlackPlayersTrackStats}
      </Text>
    </>
  );
}

/** Skip voice notes and recordings, with what it does; changing it rescans. */
function SkipVoiceNotes() {
  const { strings } = useLocalisation();
  const on = useSkipVoiceNotes();
  return (
    <View className="mt-4">
      <Hairline />
      <SettingsSwitch
        label={strings.settings.skipVoiceNotesAndRecordings}
        value={on}
        onValueChange={setSkipVoiceNotes}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        {strings.settings.leavesWhatsAppVoiceNotesOutOfTheLibrary}
      </Text>
    </View>
  );
}

/**
 * Settings › Library: the music folders, Skip voice notes and recordings,
 * Rescan library and Import BlackPlayer Stats.
 */
export function LibrarySettingsSection() {
  const { strings } = useLocalisation();
  const roots = useScanRoots();
  const scanning = useScanStatus() === "scanning";
  return (
    <View>
      <Hairline />
      <EntryRow
        label={strings.settings.musicFolders}
        count={roots.length === 0 ? undefined : roots.length}
        onPress={() => router.push("/music-folders")}
      />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        {strings.settings.theFoldersOnYourPhoneThatWave}
      </Text>
      <SkipVoiceNotes />
      <View className="mt-4 items-start">
        <TextButton
          label={scanning ? strings.settings.scanning : strings.settings.rescanLibrary}
          disabled={scanning}
          onPress={() => void startRescan()}
        />
      </View>
      <Text className="font-sans text-footnote text-secondary">
        {strings.settings.wavePicksUpNewChangedAndRemoved}
      </Text>
      <BlackPlayerImport />
    </View>
  );
}
