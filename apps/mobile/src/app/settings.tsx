import { IconCheck } from "@tabler/icons-react-native";
import { SHORTCUT_TAB_CHOICES } from "@wave/core";
import { router } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { EntryRow } from "@/catalog/EntryRow";
import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { findSection } from "@/catalog/sections";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SettingsSlider } from "@/components/SettingsSlider";
import { TextButton } from "@/components/TextButton";
import { useScanRoots, useScanState } from "@/library/hooks";
import { startRescan } from "@/library/runtime";
import { Press } from "@/motion/Press";
import { GlassSettingsSection } from "@/settings/GlassSettingsSection";
import { setShortcutTab, useShortcutTab } from "@/settings/shortcutTab";
import { ThemeSettingsSection } from "@/settings/ThemeSettingsSection";
import { setTapAnimationMs, TAP_ANIMATION, useTapAnimationMs } from "@/settings/tapAnimation";
import { useThemeColor } from "@/theme/useThemeColor";

/** One of the shortcut tab choices; the current one carries a check. */
function ShortcutChoice({
  label,
  chosen,
  onPress,
}: {
  label: string;
  chosen: boolean;
  onPress: () => void;
}) {
  const accent = useThemeColor("accent");
  return (
    <Press
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: chosen }}
      onPress={onPress}
      haptic="selection"
    >
      <View className="flex-row items-center" style={{ height: grid.row }}>
        <Text className="flex-1 font-sans text-title3 font-normal text-foreground">{label}</Text>
        {chosen && <IconCheck size={24} color={accent} strokeWidth={1.5} />}
      </View>
      <Hairline />
    </Press>
  );
}

export default function SettingsScreen() {
  const ms = useTapAnimationMs();
  const shortcut = useShortcutTab();
  const roots = useScanRoots();
  const scanning = useScanState().status === "scanning";
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: 48 }}>
        <CatalogLine className="mb-2">Library</CatalogLine>
        <Hairline />
        <EntryRow
          label="Music folders"
          count={roots.length === 0 ? undefined : roots.length}
          onPress={() => router.push("/music-folders")}
        />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          The folders on your phone that Wave shows songs from, and the folders inside them it
          ignores.
        </Text>
        <View className="mt-4 items-start">
          <TextButton
            label={scanning ? "Scanning…" : "Rescan library"}
            disabled={scanning}
            onPress={() => void startRescan()}
          />
        </View>
        <Text className="font-sans text-footnote text-secondary">
          Wave picks up new, changed and removed files each time you open it, and when you pull down
          in the Library.
        </Text>

        <CatalogLine className="mb-2 mt-12">Motion</CatalogLine>
        <Hairline />
        <SettingsSlider
          label="Tap animation"
          value={ms}
          range={TAP_ANIMATION}
          format={(value) => `${value} ms`}
          onChange={setTapAnimationMs}
        />
        <Hairline />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          How long a tap takes to sink and settle. 0 ms turns the animation off; the default is{" "}
          {TAP_ANIMATION.default} ms.
        </Text>

        <GlassSettingsSection />

        <CatalogLine className="mb-2 mt-12">Shortcut tab</CatalogLine>
        <Hairline />
        <View accessibilityRole="radiogroup" accessibilityLabel="Shortcut tab">
          {SHORTCUT_TAB_CHOICES.map((choice) => (
            <ShortcutChoice
              key={choice ?? "none"}
              label={choice === null ? "None" : (findSection(choice)?.label ?? choice)}
              chosen={choice === shortcut}
              onPress={() => setShortcutTab(choice)}
            />
          ))}
        </View>
        <Text className="mt-2 font-sans text-footnote text-secondary">
          A Library section to keep one tap away, as a third tab beside Home and Library.
        </Text>

        <ThemeSettingsSection />

        <CatalogLine className="mb-2 mt-12">Developer</CatalogLine>
        <Hairline />
        <EntryRow label="Design preview" onPress={() => router.push("/design-preview")} />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          The Library's components on synthetic data, until Wave can scan your music.
        </Text>
      </ScrollView>
    </View>
  );
}
