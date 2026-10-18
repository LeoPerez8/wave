import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { useYtListHead } from "@/ytmusic/routes";
import { useYtListPage, YtSongList } from "@/ytmusic/YtSongList";

/**
 * A YT Music playlist: cover, title, who made it,
 * Play / Shuffle and its songs (up to 5,000), shown page by page as they load.
 * Find in Playlist, pulled down above the head, narrows every page read.
 */
export default function YtPlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlistId = id ?? "";
  const known = useYtListHead("yt-playlist", playlistId);
  const load = useYtListPage("yt-playlist", playlistId);
  const context = useMemo(() => ({ kind: "ytPlaylist", id: playlistId }) as const, [playlistId]);
  return <YtSongList known={known} load={load} context={context} numbered={false} findable />;
}
