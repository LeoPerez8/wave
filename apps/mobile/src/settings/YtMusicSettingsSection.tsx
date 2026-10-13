import { Switch, Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { useThemeColor } from "@/theme/useThemeColor";

import { setYtMusicEnabled, useYtMusicEnabled } from "./ytMusic";

/** Settings › YT Music: whether Search also looks on YouTube Music. */
export function YtMusicSettingsSection() {
  const enabled = useYtMusicEnabled();
  const accent = useThemeColor("accent");
  const fill = useThemeColor("fill");
  const surface = useThemeColor("surface");

  return (
    <>
      <CatalogLine className="mb-2 mt-12">YT Music</CatalogLine>
      <Hairline />
      <View className="flex-row items-center" style={{ minHeight: grid.row }}>
        <Text className="flex-1 font-sans text-title3 font-normal text-foreground">
          Use YT Music
        </Text>
        <Switch
          accessibilityLabel="Use YT Music"
          value={enabled}
          onValueChange={setYtMusicEnabled}
          trackColor={{ false: fill, true: accent }}
          thumbColor={surface}
        />
      </View>
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        Search also finds songs on YouTube Music, which means sending what you type to YouTube.
        Nothing from your library is sent. Off, Wave makes no YT Music requests.
      </Text>
    </>
  );
}
