import { useCallback, useState } from "react";
import { RefreshControl, type RefreshControlProps } from "react-native";

import { useThemeColor } from "@/theme/useThemeColor";

import { pullToCheckForUpdates, useUpdateButtonLook } from "./appUpdates";
import { useVersionHistory, versionHistory } from "./versionHistory";

type Props = Omit<RefreshControlProps, "refreshing" | "onRefresh">;

/**
 * Pull to refresh on Settings: checks for updates now and reads the version history again. Its
 * spinner shows while either runs; a download the check starts shows on the Version History row.
 * Pass it as a scroll view's `refreshControl`; the scroll view hands it its style and children.
 */
export function UpdateCheckRefreshControl(props: Props) {
  const accent = useThemeColor("accent");
  const surface = useThemeColor("surface");
  const look = useUpdateButtonLook();
  const { status } = useVersionHistory();
  const busy = look === "checking" || status === "loading";
  const [pulled, setPulled] = useState(false);
  // The pull is over once neither runs, so a later read (the Version History page's) spins nothing.
  if (pulled && !busy) setPulled(false);
  const onRefresh = useCallback(() => {
    setPulled(true);
    pullToCheckForUpdates();
    versionHistory.load();
  }, []);
  return (
    <RefreshControl
      {...props}
      refreshing={pulled && busy}
      onRefresh={onRefresh}
      colors={[accent]}
      tintColor={accent}
      progressBackgroundColor={surface}
    />
  );
}
