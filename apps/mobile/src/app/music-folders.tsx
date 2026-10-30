import { currentLocalisation } from "@/localisation/localisation";
import { useLocalisation } from "@/localisation/localisation";
import { useScreenContent } from "@/lib/screenTiming";
import { describeFolder } from "@wave/core";
import { IconMinus } from "@tabler/icons-react-native";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { IconButton } from "@/components/IconButton";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextButton } from "@/components/TextButton";
import { useLoadedExcludedFolders, useLoadedScanRoots, useScanStatus } from "@/library/hooks";
import { promptForExcludedFolder } from "@/library/promptForExcludedFolder";
import { promptForMusicFolder } from "@/library/promptForMusicFolder";
import type { ScanRootSummary } from "@/library/LibraryStore";
import { includeMusicFolder, removeMusicFolder } from "@/library/runtime";
import { confirmAction, showError } from "@/overlay/alert";

const failed = (title: string) => (error: unknown) => showError(title, error);

const confirmRemove = async (path: string, name: string): Promise<void> => {
  const remove = await confirmAction({
    title: currentLocalisation().strings.settings.removeFolder(name),
    message: currentLocalisation().strings.settings.itsSongsLeaveYourLibraryTheFiles,
    action: { label: currentLocalisation().strings.settings.remove, destructive: true },
  });
  if (remove)
    await removeMusicFolder(path).catch(
      failed(currentLocalisation().strings.settings.couldntRemoveTheFolder),
    );
};

type FolderRowProps = {
  path: string;
  /** A line under the location, such as the song count. */
  detail?: string;
  removeLabel: string;
  removable: boolean;
  onRemove: () => void;
};

function FolderRow({ path, detail, removeLabel, removable, onRemove }: FolderRowProps) {
  const { strings } = useLocalisation();
  const label = describeFolder(path, strings);
  const parent = label.relativePath.includes("/")
    ? label.relativePath.slice(0, label.relativePath.lastIndexOf("/"))
    : null;
  const where = [label.storage, parent].filter((part) => part !== null).join(" · ");
  // Name and location wrap: two folders can share a name, and only the full location tells
  // them apart. The count goes under them rather than squeezing them from the side.
  return (
    <View>
      <View
        className="flex-row items-center"
        style={{ minHeight: grid.row, gap: CELL * 1.5, paddingVertical: CELL }}
      >
        <View className="flex-1">
          <Text className="font-sans text-body font-medium text-foreground">{label.name}</Text>
          <Text className="font-sans text-body text-secondary">{where || path}</Text>
          {detail !== undefined && (
            <Text
              className="font-sans text-subheadline text-secondary"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {detail}
            </Text>
          )}
        </View>
        <IconButton
          icon={IconMinus}
          label={`${removeLabel} ${label.name}`}
          disabled={!removable}
          opensMenu
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
  const { strings } = useLocalisation();
  const insets = useSafeAreaInsets();
  const roots = useLoadedScanRoots();
  const excluded = useLoadedExcludedFolders();
  // Both lists, or neither: a list not read yet isn't an empty one, and edits wait for both.
  const loaded = roots !== null && excluded !== null;
  useScreenContent(loaded);
  const scanning = useScanStatus() === "scanning";
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={strings.settings.musicFolders} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: grid.margin,
          paddingBottom: insets.bottom + 48,
        }}
      >
        <ScanProgressBanner />
        {loaded ? (
          <FolderLists roots={roots} excluded={excluded} scanning={scanning} />
        ) : (
          // The moment it takes to read them: blank, as the Library's lists are, but heard.
          <View
            accessible
            accessibilityLabel={strings.settings.loadingMusicFolders}
            accessibilityState={{ busy: true }}
            style={{ minHeight: grid.row }}
          />
        )}
      </ScrollView>
    </View>
  );
}

function FolderLists({
  roots,
  excluded,
  scanning,
}: {
  roots: readonly ScanRootSummary[];
  excluded: readonly string[];
  scanning: boolean;
}) {
  const { strings } = useLocalisation();
  return (
    <>
      <CatalogLine className="mb-2">{strings.settings.waveShowsSongsFrom}</CatalogLine>
      <Hairline />
      {roots.map((root) => (
        <FolderRow
          key={root.path}
          path={root.path}
          detail={
            root.lastScannedAt === null ? undefined : strings.library.songCount(root.trackCount)
          }
          removeLabel={strings.settings.remove}
          removable={roots.length > 1 && !scanning}
          onRemove={() => void confirmRemove(root.path, describeFolder(root.path, strings).name)}
        />
      ))}
      <View className="items-start">
        <TextButton
          label={strings.settings.addFolder}
          disabled={scanning}
          onPress={() => void promptForMusicFolder()}
        />
      </View>
      <Text className="font-sans text-footnote text-secondary">
        {strings.settings.everyFolderInsideTheseIsIncludedWave}
      </Text>

      <CatalogLine className="mb-2 mt-12">{strings.settings.waveIgnores}</CatalogLine>
      <Hairline />
      {excluded.map((path) => (
        <FolderRow
          key={path}
          path={path}
          removeLabel={strings.settings.stopExcluding}
          removable={!scanning}
          onRemove={() => {
            includeMusicFolder(path).catch(failed(strings.settings.couldntIncludeTheFolder));
          }}
        />
      ))}
      <View className="items-start">
        <TextButton
          label={strings.settings.excludeFolder}
          disabled={scanning}
          onPress={() => void promptForExcludedFolder()}
        />
      </View>
      <Text className="font-sans text-footnote text-secondary">
        {strings.settings.songsInExcludedFoldersAndTheFolders}
      </Text>
    </>
  );
}
