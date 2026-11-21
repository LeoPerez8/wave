import { useStackScreenOptions } from "@/chrome/tabScreens";
import { timingStackListeners } from "@/lib/timing";
import { Stack } from "expo-router";
import { View } from "react-native";

import { BACKDROP } from "@/chrome/chrome";
import { openNowPlaying } from "@/nowPlaying/sheet";
import { useRenderCount } from "@/perf/perf";
import { MiniPlayer } from "@/playback/MiniPlayer";
import { useIsSelecting } from "@/selection/selection";
import { SelectionChrome } from "@/selection/SelectionChrome";
import { UpdatePill } from "@/updates/UpdatePill";

/** Library screens pushed over the tabs keep the floating mini player, above the system inset. */
export default function LibraryLayout() {
  useRenderCount("LibraryLayout");
  const screenOptions = useStackScreenOptions();
  const selecting = useIsSelecting();
  return (
    <View className="flex-1 bg-background">
      <View nativeID={BACKDROP.library} collapsable={false} className="flex-1">
        <Stack screenListeners={timingStackListeners} screenOptions={screenOptions} />
      </View>
      {/* A list selecting swaps the mini player for its selection bar. */}
      {selecting ? (
        <SelectionChrome backdropId={BACKDROP.library} />
      ) : (
        <>
          <UpdatePill />
          <MiniPlayer backdropId={BACKDROP.library} onOpen={openNowPlaying} />
        </>
      )}
    </View>
  );
}
