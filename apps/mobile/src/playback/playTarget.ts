import type { LibrarySectionSlug, QueueContext } from "@wave/core";

import { playlistEntries } from "@/library/sectionSongs";
import { showError } from "@/overlay/alert";
import { showToast } from "@/overlay/toast";

import { targetEntries, type ActionItems } from "./actionTargets";
import { playPlaylist, playSongs } from "./actions";

/** The queue context of a Library entry, as its own list plays it (Songs, Favorites). */
const sectionContext = (slug: LibrarySectionSlug): QueueContext =>
  slug === "songs" || slug === "favorites"
    ? { kind: slug, id: null }
    : { kind: "librarySection", id: slug };

/**
 * A collection menu's Play and Shuffle: replaces the queue with [target]'s
 * songs (its one item's), in the order its page plays them, from the first
 * song or shuffled ([shuffle]), as its page's Play and Shuffle do. A
 * playlist plays as its page does, its YT Music entries streamed while YT
 * Music is on (Core's `playlistPlayback`), and says why when nothing can.
 * Songs have no Play: a tap plays them.
 */
export const playTarget = (target: ActionItems, shuffle: boolean): void => {
  const play = async (): Promise<void> => {
    switch (target.kind) {
      case "playlist": {
        const playlist = target.items[0];
        if (playlist === undefined) return;
        const entries = await playlistEntries(playlist.id);
        const context = { kind: "playlist", id: String(playlist.id) };
        const notice = await playPlaylist(entries, undefined, context, { shuffle });
        if (notice !== null) void showToast(notice);
        return;
      }
      case "album":
      case "artist":
      case "genre":
      case "section": {
        const item = target.items[0];
        if (item === undefined) return;
        const context: QueueContext =
          "slug" in item ? sectionContext(item.slug) : { kind: target.kind, id: String(item.id) };
        const songs = (await targetEntries(target)).flatMap((entry) =>
          entry.source === "library" ? [entry.track] : [],
        );
        await playSongs(songs, undefined, context, { shuffle });
        return;
      }
      case "track":
      case "mixed":
        return;
    }
  };
  play().catch((error: unknown) => showError("Couldn't load the songs", error));
};
