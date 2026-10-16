import { router } from "expo-router";
import { Text, View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { Hairline } from "@/catalog/Hairline";
import { SettingsPageScreen } from "@/settings/SettingsPage";

/** Settings › Developer: the Design preview. */
export default function DeveloperSettingsScreen() {
  return (
    <SettingsPageScreen page="developer">
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
