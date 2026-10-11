import { useCallback, useState } from "react";
import { RefreshControl, type RefreshControlProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThemeColor } from "@/theme/useThemeColor";

import { startRescan } from "./runtime";

type Props = Omit<RefreshControlProps, "refreshing" | "onRefresh">;

/**
 * Pull to refresh that rescans the music folders. Pass it as a scroll view's
 * `refreshControl`; the scroll view hands it its style and children.
 */
export function RescanRefreshControl(props: Props) {
  const insets = useSafeAreaInsets();
  const accent = useThemeColor("accent");
  const surface = useThemeColor("surface");
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // A scan already running (the launch rescan) is waited for rather than restarted.
    void startRescan().finally(() => setRefreshing(false));
  }, []);
  return (
    <RefreshControl
      {...props}
      refreshing={refreshing}
      onRefresh={onRefresh}
      colors={[accent]}
      tintColor={accent}
      progressBackgroundColor={surface}
      progressViewOffset={insets.top}
    />
  );
}
