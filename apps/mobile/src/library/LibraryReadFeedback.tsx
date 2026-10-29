import type { Catalogue } from "@wave/core";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { SkeletonLine } from "@/catalog/SkeletonLine";
import { AlbumCardSkeleton, SkeletonGroup, TrackSkeletons } from "@/catalog/Skeletons";
import { useChromeInset } from "@/chrome/chrome";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";
import { TextButton } from "@/components/TextButton";
import { useScreenContent } from "@/lib/screenTiming";
import { useLocalisation } from "@/localisation/localisation";

import { libraryQueryState, retryLibraryQuery } from "./sharedQueries";

type Shape = "songs" | "albums" | "artists" | "genres";

/** The list being read, which names it in the loading and failure lines. */
type ReadList = keyof Catalogue["library"]["loadingList"];

/** Still placeholders matching the list ahead, without preparing any Library data. */
function LoadingList({ list, shape }: { list: ReadList; shape: Shape }) {
  const { width, fontScale } = useWindowDimensions();
  const loading = useLocalisation().strings.library.loadingList[list];
  if (shape === "songs") return <TrackSkeletons label={loading} />;
  const tile = Math.max(0, (width - grid.margin * 2 - grid.gutter) / 2);
  return (
    <SkeletonGroup label={loading}>
      {shape === "albums" ? (
        <View className="flex-row" style={{ gap: grid.gutter }}>
          <AlbumCardSkeleton size={tile} fontScale={fontScale} />
          <AlbumCardSkeleton size={tile} fontScale={fontScale} />
        </View>
      ) : (
        Array.from({ length: 3 }, (_, index) => (
          <View
            key={index}
            className="flex-row items-center"
            style={{ height: grid.row, gap: CELL * 1.5 }}
          >
            {shape === "artists" && (
              <View
                className="bg-fill"
                style={{ width: CELL * 5, height: CELL * 5, borderRadius: CELL * 2.5 }}
              />
            )}
            <View className="flex-1">
              <SkeletonLine lineHeight={22} width="60%" />
              <SkeletonLine lineHeight={22} width="40%" />
            </View>
          </View>
        ))
      )}
    </SkeletonGroup>
  );
}

/**
 * First-read feedback alongside the parent's shared query subscription. Failure
 * is distinct from an empty answer; Retry repeats only that query, once.
 */
export function LibraryReadFeedback({
  queryKey,
  list,
  shape = "songs",
  scan = false,
}: {
  queryKey: string;
  /** The list being read, which its loading and failure lines name. */
  list: ReadList;
  shape?: Shape;
  scan?: boolean;
}) {
  const state = libraryQueryState(queryKey);
  const bottomInset = useChromeInset();
  useScreenContent(state === "error");
  return (
    <ScrollView
      className="flex-1"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
    >
      {scan && <ScanProgressBanner />}
      <LibraryReadNote queryKey={queryKey} list={list} shape={shape} />
    </ScrollView>
  );
}

/** Inline feedback keeps Find's field, query and keyboard reachable during a read or retry. */
export function LibraryReadNote({
  queryKey,
  list,
  shape = "songs",
}: {
  queryKey: string;
  list: ReadList;
  shape?: Shape;
}) {
  const { strings } = useLocalisation();
  const state = libraryQueryState(queryKey);
  return state === "error" ? (
    <View style={{ gap: CELL, paddingTop: CELL * 3 }}>
      <Text accessibilityLiveRegion="polite" className="font-sans text-subheadline text-secondary">
        {strings.library.couldntLoadList[list]}
      </Text>
      <TextButton label={strings.library.tryAgain} onPress={() => retryLibraryQuery(queryKey)} />
    </View>
  ) : (
    <LoadingList list={list} shape={shape} />
  );
}
