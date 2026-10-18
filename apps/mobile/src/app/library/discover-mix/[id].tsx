import { IconCompass } from "@tabler/icons-react-native";
import { discoverMixCaption } from "@wave/core";
import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";

import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useDiscoverMix } from "@/home/discoverMixes";
import { YtSongList, type YtListLoad } from "@/ytmusic/YtSongList";

/**
 * One of Home's Discover mixes: its cover (its first song's), its name and
 * artists, Play / Shuffle / Download (every song, with the progress in the
 * head) and its songs, as last built. Songs downloaded since play their files.
 */
export default function DiscoverMixScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const mixId = id ?? "";
  const mix = useDiscoverMix(mixId);
  const load = useMemo<YtListLoad | null>(() => {
    if (mix === null) return null;
    const caption = discoverMixCaption(mix);
    return {
      status: "loaded",
      page: {
        head: {
          title: caption.title,
          line: caption.artists,
          artworkUrl: mix.songs[0]?.artworkUrl ?? null,
        },
        kind: "Mix",
        songs: mix.songs,
      },
      rest: "read",
    };
  }, [mix]);
  const context = useMemo(() => ({ kind: "discoverMix", id: mixId }) as const, [mixId]);

  if (load === null) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader />
        <EmptyState
          icon={IconCompass}
          title="This mix is gone"
          message="Home has today's mixes while YT Music is on."
        />
      </View>
    );
  }
  return (
    <YtSongList
      known={undefined}
      load={load}
      context={context}
      numbered={false}
      albumDownload="mix"
    />
  );
}
