import { describeFolder } from "@wave/core";
import { IconMinus } from "@tabler/icons-react-native";
import { Alert, ScrollView, Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { IconButton } from "@/components/IconButton";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextButton } from "@/components/TextButton";
import { useScanRoots, useScanState } from "@/library/hooks";
import type { ScanRootSummary } from "@/library/LibraryStore";
import { promptForMusicFolder } from "@/library/promptForMusicFolder";
import { removeMusicFolder } from "@/library/runtime";

const songCount = (n: number): string => `${n.toLocaleString("en")} ${n === 1 ? "song" : "songs"}`;

const confirmRemove = (path: string, name: string) =>
  Alert.alert(`Remove ${name}?`, "Its songs leave your library. The files stay on your phone.", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Remove",
      style: "destructive",
      onPress: () => {
        removeMusicFolder(path).catch((error: unknown) =>
          Alert.alert(
            "Couldn't remove the folder",
            error instanceof Error ? error.message : String(error),
          ),
        );
      },
    },
  ]);

function FolderRow({ root, removable }: { root: ScanRootSummary; removable: boolean }) {
  const label = describeFolder(root.path);
  const parent = label.relativePath.includes("/")
    ? label.relativePath.slice(0, label.relativePath.lastIndexOf("/"))
    : null;
  const where = [label.storage, parent].filter((part) => part !== null).join(" · ");
  return (
    <View>
      <View className="flex-row items-center" style={{ height: grid.row, gap: CELL * 1.5 }}>
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {label.name}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {where || root.path}
          </Text>
        </View>
        <Text
          className="font-sans text-subheadline text-secondary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {root.lastScannedAt === null ? "" : songCount(root.trackCount)}
        </Text>
        <IconButton
          icon={IconMinus}
          label={`Remove ${label.name}`}
          disabled={!removable}
          onPress={() => confirmRemove(root.path, label.name)}
        />
      </View>
      <Hairline />
    </View>
  );
}

/** The folders Wave shows songs from: add one with the system picker, remove one. */
export default function MusicFoldersScreen() {
  const roots = useScanRoots();
  const scanning = useScanState().status === "scanning";
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Music folders" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: 48 }}>
        <ScanProgressBanner />
        <CatalogLine className="mb-2">Wave shows songs from</CatalogLine>
        <Hairline />
        {roots.map((root) => (
          <FolderRow key={root.path} root={root} removable={roots.length > 1 && !scanning} />
        ))}
        <View className="items-start">
          <TextButton
            label="Add folder"
            disabled={scanning}
            onPress={() => void promptForMusicFolder()}
          />
        </View>
        <Text className="font-sans text-footnote text-secondary">
          Every folder inside these is included. Wave keeps at least one folder, and folders can't
          change while a scan runs.
        </Text>
      </ScrollView>
    </View>
  );
}
