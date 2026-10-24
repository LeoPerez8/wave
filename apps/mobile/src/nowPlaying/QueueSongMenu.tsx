import { openTrackActionsById, openUnsearchedActions } from "@/playback/ActionsMenu";
import { queueTracks } from "@/playback/queueTracks";
import { openYtSongActions } from "@/ytmusic/YtSongActions";

import { queueSongMenuTarget } from "./queueSongMenu";

/** Opens a queue song's usual menu from either an Up Next or History row. */
export const openQueueSongActions = (trackId: string): void => {
  const target = queueSongMenuTarget(trackId, queueTracks.get().get(trackId));
  switch (target?.kind) {
    case "library":
      openTrackActionsById(target.id);
      break;
    case "stream":
      openYtSongActions(target.song);
      break;
    case "unsearched":
      openUnsearchedActions(target.song);
      break;
  }
};
