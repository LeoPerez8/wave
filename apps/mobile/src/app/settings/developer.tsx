import { useScreenContent } from "@/lib/screenTiming";
import { router } from "@/lib/timingRouter";
import { Text, View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import {
  setCollaborativePlaylists,
  useCollaborativePlaylists,
} from "@/settings/collaborativePlaylists";
import { exportAppLog, saveAppLog } from "@/log/appLog";
import { WaveAppLog } from "@/native/waveAppLog";
import { showToast } from "@/overlay/toast";
import { SettingsPageScreen } from "@/settings/SettingsPage";

const exportLogs = (): void => {
  exportAppLog().catch((error: unknown) => {
    console.warn("[wave] Couldn't export the logs", error);
    void showToast("Couldn't export the logs");
  });
};

const saveLogs = (): void => {
  saveAppLog().then(
    () => void showToast("Saved to Downloads/Wave"),
    (error: unknown) => {
      console.warn("[wave] Couldn't save the logs", error);
      void showToast("Couldn't save the logs");
    },
  );
};

/** Holds the JS thread for five seconds, as a frozen screen would: the app log records a freeze. */
const stallJsThread = (): void => {
  setTimeout(() => {
    const until = Date.now() + 5_000;
    while (Date.now() < until) {
      // Busy on purpose.
    }
  }, 0);
};

/** Collaborative playlists, off until they ship: on, the next sync brings them. */
function CollaborativePlaylistsSwitch() {
  const on = useCollaborativePlaylists();
  return (
    <View>
      <Hairline />
      <SettingsSwitch
        label="Collaborative playlists"
        value={on}
        onValueChange={setCollaborativePlaylists}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        For testing. Syncs the playlists this Wave account shares with other accounts, at the next
        sync. Off, they stay as the last sync left them.
      </Text>
    </View>
  );
}

/**
 * Settings › Developer: logs, the collaborative playlists' switch, the Design preview and, in
 * a debug build, the log's triggers.
 */
export default function DeveloperSettingsScreen() {
  useScreenContent(true);
  return (
    <SettingsPageScreen page="developer">
      <View>
        <Hairline />
        <EntryRow label="Save Logs" onPress={saveLogs} />
        <EntryRow label="Export Logs" onPress={exportLogs} />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          Save what Wave noted on this phone to Downloads/Wave, or share it as a text file. It holds
          no passwords or sign-ins.
        </Text>
      </View>
      <CollaborativePlaylistsSwitch />
      <View>
        <Hairline />
        <EntryRow label="Design preview" onPress={() => router.push("/design-preview")} />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          The Library's components on synthetic data, until Wave can scan your music.
        </Text>
      </View>
      {__DEV__ && WaveAppLog !== null && (
        <View>
          <Hairline />
          <EntryRow label="Crash Wave (Kotlin)" destructive onPress={() => WaveAppLog?.crash()} />
          <EntryRow label="Freeze the JS thread for 5 s" onPress={stallJsThread} />
          <Text className="mt-2 font-sans text-footnote text-secondary">
            Debug builds only. The next export shows the crash, flagged at the next launch, or the
            freeze.
          </Text>
        </View>
      )}
    </SettingsPageScreen>
  );
}
