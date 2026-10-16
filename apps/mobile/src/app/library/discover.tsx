import {
  IconCloudOff,
  IconMoodEmpty,
  IconUserCircle,
  IconWifiOff,
  IconWorldOff,
} from "@tabler/icons-react-native";
import { router } from "expo-router";
import { RefreshControl, ScrollView, Text, View } from "react-native";

import { grid } from "@/catalog/grid";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextButton } from "@/components/TextButton";
import { useListScrollable } from "@/motion/heldTouch";
import { useThemeColor } from "@/theme/useThemeColor";
import { useDiscover, type Discover } from "@/ytmusic/discover";
import { DiscoverShelves } from "@/ytmusic/DiscoverShelves";

/** What Discover shows instead of shelves (Core's `discoverView`); never an error card. */
function Instead({ view }: { view: Discover["view"] }) {
  switch (view.kind) {
    case "shelves":
      return null;
    case "loading":
      return (
        <Text className="pt-6 font-sans text-subheadline text-secondary">
          Asking YouTube Music for recommendations…
        </Text>
      );
    case "signedOut":
      return (
        <EmptyState
          icon={IconUserCircle}
          title="Recommendations come from your account"
          message="Discover shows what YouTube Music recommends for your YouTube account. Sign in to it in Settings to see them here."
          action={
            <TextButton label="Open Settings" onPress={() => router.push("/settings/accounts")} />
          }
        />
      );
    case "offline":
      return (
        <EmptyState
          icon={IconWifiOff}
          title="You're offline"
          message="Discover needs the network. Your library plays as always."
        />
      );
    case "failed":
      return (
        <EmptyState
          icon={IconCloudOff}
          title="No answer from YouTube Music"
          message="Pull down to ask again."
        />
      );
    case "empty":
      return (
        <EmptyState
          icon={IconMoodEmpty}
          title="Nothing to recommend yet"
          message="YouTube Music has no recommendations for this account right now. Pull down to ask again."
        />
      );
    case "off":
      return (
        <EmptyState
          icon={IconWorldOff}
          title="YT Music is off"
          message="Turn on Use YT Music in Settings to see recommendations."
        />
      );
  }
}

/**
 * Discover: what YouTube Music recommends for the signed-in account, its
 * home's shelves in Wave's own layout. Pull to refresh asks again.
 */
export default function DiscoverScreen() {
  const { view, refreshing, refresh } = useDiscover();
  const scrollable = useListScrollable();
  const bottom = useChromeInset();
  const accent = useThemeColor("accent");
  const surface = useThemeColor("surface");
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Discover" />
      <ScrollView
        scrollEnabled={scrollable}
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottom }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            colors={[accent]}
            tintColor={accent}
            progressBackgroundColor={surface}
          />
        }
      >
        {view.kind === "shelves" ? (
          <DiscoverShelves shelves={view.shelves} />
        ) : (
          <Instead view={view} />
        )}
      </ScrollView>
    </View>
  );
}
