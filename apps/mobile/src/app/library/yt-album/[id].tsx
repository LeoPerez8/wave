import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { useYtListHead } from "@/ytmusic/routes";
import { useYtListPage, YtSongList } from "@/ytmusic/YtSongList";

/**
 * A YT Music album opened from Discover (its `MPREb_…` page, read as a
 * download reads it): cover, title, artists, Play / Shuffle and its songs by
 * number.
 */
export default function YtAlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const browseId = id ?? "";
  const known = useYtListHead("yt-album", browseId);
  const load = useYtListPage("yt-album", browseId);
  const context = useMemo(() => ({ kind: "ytAlbum", id: browseId }) as const, [browseId]);
  return <YtSongList known={known} load={load} context={context} numbered />;
}
