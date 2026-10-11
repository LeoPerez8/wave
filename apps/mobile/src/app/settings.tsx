import { IconMinus, IconPlus } from "@tabler/icons-react-native";
import { router } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { EntryRow } from "@/catalog/EntryRow";
import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { IconButton } from "@/components/IconButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextButton } from "@/components/TextButton";
import { useScanRoots, useScanState } from "@/library/hooks";
import { startRescan } from "@/library/runtime";
import { setTapAnimationMs, TAP_ANIMATION, useTapAnimationMs } from "@/settings/tapAnimation";

export default function SettingsScreen() {
  const ms = useTapAnimationMs();
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
        <View className="flex-row items-center" style={{ minHeight: grid.row }}>
          <Text className="flex-1 font-sans text-title3 font-normal text-foreground">
            Tap animation
          </Text>
          <IconButton
            icon={IconMinus}
            label="Shorter tap animation"
            disabled={ms <= TAP_ANIMATION.min}
            onPress={() => setTapAnimationMs(ms - TAP_ANIMATION.step)}
          />
          <Text
            accessibilityLiveRegion="polite"
            className="text-center font-sans text-body font-medium text-foreground"
            numberOfLines={1}
            style={{ minWidth: 72, fontVariant: ["tabular-nums"] }}
          >
            {ms} ms
          </Text>
          <IconButton
            icon={IconPlus}
            label="Longer tap animation"
            disabled={ms >= TAP_ANIMATION.max}
            onPress={() => setTapAnimationMs(ms + TAP_ANIMATION.step)}
          />
        </View>
        <Hairline />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          How long a tap takes to sink and settle. 0 ms turns the animation off; the default is{" "}
          {TAP_ANIMATION.default} ms.
        </Text>

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
