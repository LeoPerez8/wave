import { cancelGroupDownloadsAlert } from "@wave/core";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { confirmAction } from "@/overlay/alert";
import type { MenuChoice } from "@/overlay/MenuChoices";
import {
  cancelAllDownloads,
  downloadGroupControlsNow,
  pauseDownloadGroup,
  resumeDownloadGroup,
  useOwnerPause,
} from "./YtDownloads";

/**
 * A group's Cancel: asks "Cancel 12 downloads?" for its songs waiting or downloading now (Core's
 * `downloadGroupControls`), then cancels those. Downloaded songs stay.
 */
export const cancelDownloadGroup = async (key: string): Promise<void> => {
  const ids = downloadGroupControlsNow(key)?.toCancel ?? [];
  if (ids.length === 0) return;
  if (await confirmAction(cancelGroupDownloadsAlert(ids.length, currentLocalisation().language)))
    cancelAllDownloads(ids);
};

/** The group [key]'s Pause or Resume (while [paused]). */
export const toggleDownloadGroup = (key: string, paused: boolean): void =>
  paused ? resumeDownloadGroup(key) : pauseDownloadGroup(key);

/**
 * Pause or Resume, and Cancel, on one playlist's, album's or other group's downloads (#1475):
 * under its page's progress line and on its header in Settings › Downloads. [group] is Core's
 * `downloadGroupKey`. While the global Pause holds every download it offers Cancel alone: the
 * global Resume is what restarts them.
 */
export function DownloadGroupControls({ group }: { group: string }) {
  const { strings } = useLocalisation();
  const pause = useOwnerPause();
  const paused = pause.groups.includes(group);
  const run = strings.downloads.run;
  return (
    <View className="flex-row items-center" style={{ gap: CELL * 3 }}>
      {!pause.all && (
        <TextButton
          variant="plain"
          label={paused ? run.resumeGroup : run.pauseGroup}
          onPress={() => toggleDownloadGroup(group, paused)}
        />
      )}
      <TextButton
        variant="plain"
        tone="destructive"
        label={run.cancelGroup}
        onPress={() => void cancelDownloadGroup(group)}
      />
    </View>
  );
}

/**
 * A page's download progress line ("Downloading · 3 of 10", "Paused · 3 of 10") with its group's
 * Pause or Resume and Cancel under it while it shows.
 */
export function DownloadProgressLine({
  download: { progress, group },
}: {
  download: { readonly progress: string | null; readonly group: string | null };
}) {
  if (progress === null) return null;
  return (
    <>
      <Text
        className="font-sans text-footnote text-accent"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {progress}
      </Text>
      {group !== null && <DownloadGroupControls group={group} />}
    </>
  );
}

/**
 * A playlist's or album's menu entry for its group's downloads (#1475): Pause Downloads, or
 * Resume Downloads while it's paused, while its songs are on their way ([active]: its progress
 * line shows). None while the global Pause holds everything. It closes the menu ([close]) first.
 */
export const useDownloadGroupMenuEntries = (
  group: string | null,
  active: boolean,
  close: () => void,
): MenuChoice[] => {
  const { strings } = useLocalisation();
  const pause = useOwnerPause();
  if (group === null || !active || pause.all) return [];
  const paused = pause.groups.includes(group);
  const run = strings.downloads.run;
  return [
    {
      action: paused ? "resumeDownloads" : "pauseDownloads",
      label: paused ? run.resumeGroup : run.pauseGroup,
      onPress: () => {
        close();
        toggleDownloadGroup(group, paused);
      },
    },
  ];
};
