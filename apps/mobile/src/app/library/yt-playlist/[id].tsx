import { useScreenContent } from "@/lib/screenTiming";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";

import { useYtListHead } from "@/ytmusic/routes";
import { ytListHeadToKeep } from "@/ytmusic/ytListHead";
import { keepYtPlaylistHead } from "@/ytmusic/ytPlaylistHeads";
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
  useScreenContent(true);
  const { load, retry } = useYtListPage("yt-playlist", playlistId);
  // Recently played's card shows the playlist as it was last read here.
  const read = ytListHeadToKeep(load);
  const title = read?.title;
  const line = read?.line;
  const artworkUrl = read?.artworkUrl;
  useEffect(() => {
    if (title === undefined || line === undefined || artworkUrl === undefined) return;
    keepYtPlaylistHead(playlistId, { title, line, artworkUrl });
  }, [playlistId, title, line, artworkUrl]);
  const context = useMemo(() => ({ kind: "ytPlaylist", id: playlistId }) as const, [playlistId]);
  return (
    <YtSongList
      known={known}
      load={load}
      onRetry={retry}
      context={context}
      numbered={false}
      findable
    />
  );
}
