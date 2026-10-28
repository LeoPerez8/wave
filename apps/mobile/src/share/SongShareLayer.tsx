import { SongSharePreview } from "./SongSharePreview";
import { useSongShare } from "./songShare";

/**
 * The song share sheet while one is open (`openSongShare`), over Now Playing
 * and the app. The sheet and its card (and Skia with them) load the first
 * time one opens.
 */
export function SongShareLayer() {
  const content = useSongShare();
  return content === null ? null : <SongSharePreview content={content} />;
}
