import { router } from "expo-router";
import { Text, View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { Hairline } from "@/catalog/Hairline";
import { exportAppLog } from "@/log/appLog";
import { showToast } from "@/overlay/toast";
import { SettingsPageScreen } from "@/settings/SettingsPage";

const exportLogs = (): void => {
  exportAppLog().catch((error: unknown) => {
    console.warn("[wave] Couldn't export the logs", error);
    void showToast("Couldn't export the logs");
  });
};

/** Settings › Developer: Export Logs and the Design preview. */
export default function DeveloperSettingsScreen() {
  return (
    <SettingsPageScreen page="developer">
      <View>
        <Hairline />
        <EntryRow label="Export Logs" onPress={exportLogs} />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          Shares what Wave noted on this phone, such as errors, as a text file. It holds no
          passwords or sign-ins.
        </Text>
      </View>
      <View>
        <Hairline />
        <EntryRow label="Design preview" onPress={() => router.push("/design-preview")} />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          The Library's components on synthetic data, until Wave can scan your music.
        </Text>
      </View>
    </SettingsPageScreen>
  );
}
