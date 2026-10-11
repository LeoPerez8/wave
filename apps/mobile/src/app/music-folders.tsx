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
import { useExcludedFolders, useScanRoots, useScanState } from "@/library/hooks";
import { promptForExcludedFolder } from "@/library/promptForExcludedFolder";
import { promptForMusicFolder } from "@/library/promptForMusicFolder";
import { includeMusicFolder, removeMusicFolder } from "@/library/runtime";

const songCount = (n: number): string => `${n.toLocaleString("en")} ${n === 1 ? "song" : "songs"}`;

const showError = (title: string) => (error: unknown) =>
  Alert.alert(title, error instanceof Error ? error.message : String(error));

const confirmRemove = (path: string, name: string) =>
  Alert.alert(`Remove ${name}?`, "Its songs leave your library. The files stay on your phone.", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Remove",
      style: "destructive",
      onPress: () => {
        removeMusicFolder(path).catch(showError("Couldn't remove the folder"));
      },
    },
  ]);

type FolderRowProps = {
  path: string;
  /** Trailing detail, such as the song count. */
  detail?: string;
  removeLabel: string;
  removable: boolean;
  onRemove: () => void;
};

function FolderRow({ path, detail, removeLabel, removable, onRemove }: FolderRowProps) {
  const label = describeFolder(path);
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
            {where || path}
          </Text>
        </View>
        {detail !== undefined && (
          <Text
            className="font-sans text-subheadline text-secondary"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {detail}
          </Text>
        )}
        <IconButton
          icon={IconMinus}
          label={`${removeLabel} ${label.name}`}
          disabled={!removable}
          onPress={onRemove}
        />
      </View>
      <Hairline />
    </View>
  );
}

/**
 * The folders Wave shows songs from (add one with the system picker, remove
 * one) and the folders inside them it ignores. Excluding or including a folder
 * rescans the library.
 */
export default function MusicFoldersScreen() {
  const roots = useScanRoots();
  const excluded = useExcludedFolders();
  const scanning = useScanState().status === "scanning";
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Music folders" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: 48 }}>
        <ScanProgressBanner />
        <CatalogLine className="mb-2">Wave shows songs from</CatalogLine>
        <Hairline />
        {roots.map((root) => (
          <FolderRow
            key={root.path}
            path={root.path}
            detail={root.lastScannedAt === null ? "" : songCount(root.trackCount)}
            removeLabel="Remove"
            removable={roots.length > 1 && !scanning}
            onRemove={() => confirmRemove(root.path, describeFolder(root.path).name)}
          />
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

        <CatalogLine className="mb-2 mt-12">Wave ignores</CatalogLine>
        <Hairline />
        {excluded.map((path) => (
          <FolderRow
            key={path}
            path={path}
            removeLabel="Stop excluding"
            removable={!scanning}
            onRemove={() => {
              includeMusicFolder(path).catch(showError("Couldn't include the folder"));
            }}
          />
        ))}
        <View className="items-start">
          <TextButton
            label="Exclude folder"
            disabled={scanning}
            onPress={() => void promptForExcludedFolder()}
          />
        </View>
        <Text className="font-sans text-footnote text-secondary">
          Songs in excluded folders, and the folders inside them, leave your library. The files stay
          on your phone.
        </Text>
      </ScrollView>
    </View>
  );
}
