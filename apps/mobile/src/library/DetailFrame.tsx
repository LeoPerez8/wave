import { IconStack2 } from "@tabler/icons-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { grid } from "@/catalog/grid";
import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";

type Props<A> = {
  /** `undefined` while loading, `null` once the item left the library. */
  detail: A | null | undefined;
  /** "album", "artist"… for the gone state. */
  noun: string;
  title?: (detail: A) => string;
  /** The gone state's message, when "its files are gone" isn't why (a deleted playlist). */
  goneMessage?: string;
  children: (detail: A) => ReactNode;
};

/** A pushed detail screen: Back (and the title), then the content once it has loaded. */
export function DetailFrame<A>({ detail, noun, title, goneMessage, children }: Props<A>) {
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={detail != null && title !== undefined ? title(detail) : undefined} />
      {detail === null ? (
        <View style={{ paddingHorizontal: grid.margin }}>
          <EmptyState
            icon={IconStack2}
            title={`This ${noun} is gone`}
            message={goneMessage ?? "Its files are no longer in your music folders."}
          />
        </View>
      ) : detail === undefined ? null : (
        children(detail)
      )}
    </View>
  );
}
