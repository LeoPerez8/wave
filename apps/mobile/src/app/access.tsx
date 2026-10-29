import { useLocalisation } from "@/localisation/localisation";
import { useScreenContent } from "@/lib/screenTiming";
import { IconFolderOpen } from "@tabler/icons-react-native";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CELL, grid } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { useAllFilesAccess } from "@/library/hooks";
import { useThemeColor } from "@/theme/useThemeColor";

/**
 * Shown instead of the tabs until Wave holds all-files access. The root layout
 * swaps to the tabs as soon as access is granted and the app is active again.
 */
export default function AccessScreen() {
  const { strings } = useLocalisation();
  useScreenContent(true);
  const insets = useSafeAreaInsets();
  const tertiary = useThemeColor("tertiary");
  const { denied, failed, request } = useAllFilesAccess();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: grid.margin,
        paddingTop: insets.top + CELL * 12,
        paddingBottom: insets.bottom + CELL * 4,
        gap: CELL * 2,
      }}
    >
      <IconFolderOpen size={40} color={tertiary} strokeWidth={1.25} />
      <Text
        accessibilityRole="header"
        className="font-sans text-large-title font-light text-foreground"
        style={{ letterSpacing: -0.6 }}
      >
        {denied
          ? strings.settings.waveCantSeeYourMusicYet
          : strings.settings.allowAccessToYourMusic}
      </Text>
      <Text accessibilityLiveRegion="polite" className="font-sans text-body text-secondary">
        {denied
          ? strings.settings.allFilesAccessIsStillOffTurn
          : strings.settings.wavePlaysTheAudioFilesOnThis}
      </Text>
      {failed && (
        <Text accessibilityLiveRegion="polite" className="font-sans text-body text-secondary">
          {strings.settings.couldntOpenAndroidSettingsTryAgainOr}
        </Text>
      )}
      <View className="items-start">
        {/* Not disabled while Android opens settings: that lasts a frame, and taps then ask nothing. */}
        <TextButton
          label={denied || failed ? strings.settings.tryAgainText : strings.settings.openSettings}
          onPress={() => void request()}
        />
      </View>
    </ScrollView>
  );
}
