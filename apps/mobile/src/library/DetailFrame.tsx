import { IconStack2 } from "@tabler/icons-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { grid } from "@/catalog/grid";
import { TrackSkeletons } from "@/catalog/Skeletons";
import { CompactTitleFrame } from "@/components/CompactTitle";
import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useLocalisation } from "@/localisation/localisation";

type Props<A> = {
  /** `undefined` while loading, `null` once the item left the library. */
  detail: A | null | undefined;
  /** What it is, for the gone and loading states. */
  noun: "album" | "artist" | "genre" | "playlist";
  title?: (detail: A) => string;
  /** The title the content scrolls away, for beside Back; its list runs `useCompactTitleList`. */
  compactTitle?: (detail: A) => string;
  /** The gone state's message, when "its files are gone" isn't why (a deleted playlist). */
  goneMessage?: string;
  children: (detail: A) => ReactNode;
};

/** A pushed detail screen: Back (and the title), then the content once it has loaded. */
export function DetailFrame<A>({
  detail,
  noun,
  title,
  compactTitle,
  goneMessage,
  children,
}: Props<A>) {
  const { strings } = useLocalisation();
  const frame = (
    <View className="flex-1 bg-background">
      <ScreenHeader title={detail != null && title !== undefined ? title(detail) : undefined} />
      {detail === null ? (
        <View style={{ paddingHorizontal: grid.margin }}>
          <EmptyState
            icon={IconStack2}
            title={strings.library.gone[noun]}
            message={goneMessage ?? strings.library.filesGone}
          />
        </View>
      ) : detail === undefined ? (
        <View style={{ paddingHorizontal: grid.margin }}>
          <TrackSkeletons label={strings.library.loadingDetail[noun]} />
        </View>
      ) : (
        children(detail)
      )}
    </View>
  );
  return compactTitle === undefined ? (
    frame
  ) : (
    <CompactTitleFrame title={detail == null ? undefined : compactTitle(detail)}>
      {frame}
    </CompactTitleFrame>
  );
}
