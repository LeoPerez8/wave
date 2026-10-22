import { useScreenContent } from "@/lib/screenTiming";
import { IconCompass } from "@tabler/icons-react-native";
import { discoverMixCaption, placeDiscoverMixSongs } from "@wave/core";
import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";

import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { newSongsOf, useDiscoverMix, useLibraryTracks } from "@/home/discoverMixes";
import { useLibraryFinder } from "@/ytmusic/libraryFinder";
import { YtSongList, type YtListLoad } from "@/ytmusic/YtSongList";

/**
 * One of Home's Discover mixes, as the owner's level blends it: its cover
 * (its tile's, following the level), its name and artists, Play / Shuffle /
 * Download (every song it streams, new or familiar, with the progress in the
 * head) and its songs, as last built, the familiar ones among the new ones.
 * Songs downloaded since play their files.
 */
export default function DiscoverMixScreen() {
  useScreenContent(true);
  const { id } = useLocalSearchParams<{ id: string }>();
  const mixId = id ?? "";
  const tracks = useLibraryTracks();
  const mix = useDiscoverMix(mixId, tracks);
  const find = useLibraryFinder();
  const load = useMemo<YtListLoad | null>(() => {
    if (mix === null) return null;
    const caption = discoverMixCaption(mix);
    return {
      status: "loaded",
      page: {
        head: { title: caption.title, line: caption.artists, artworkUrl: caption.artworkUrl },
        kind: "Mix",
        songs: newSongsOf(mix),
        listed: placeDiscoverMixSongs(mix, {
          find,
          track: (trackId) => tracks?.get(trackId) ?? null,
        }),
      },
      rest: "read",
    };
  }, [mix, find, tracks]);
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
