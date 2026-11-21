/**
 * Home's New from Artists You Follow, played from its header's Play: which releases play and in
 * what order, how each one read joins the queue, and what Up Next says over it.
 */
import { en, type Catalogue } from "./catalogueEn.ts";
import type { FollowRelease } from "./followedArtists.ts";
import type { QueueContext } from "./queue.ts";

/** The queue context's kind while the section plays; its id is that play's own. */
export const FOLLOW_PLAY_CONTEXT = "newReleases";

/** Where one release's songs come from: the Library's album, or its YT Music album. */
export type FollowPlaySource =
  | { readonly kind: "library"; readonly key: string; readonly albumId: number }
  | { readonly kind: "yt"; readonly key: string; readonly browseId: string };

/**
 * What the section's Play plays, in the section's order ([cards], newest first): each release's
 * Library album when it has one (its songs play their files), else its YT Music match while YT
 * Music is on; a release with neither is left out.
 */
export const followPlaySources = (
  cards: readonly FollowRelease[],
  options: { readonly ytMusic: boolean },
): FollowPlaySource[] =>
  cards.flatMap((r): FollowPlaySource[] =>
    r.libraryAlbumId
      ? [{ kind: "library", key: r.key, albumId: r.libraryAlbumId }]
      : options.ytMusic && r.browseId !== null
        ? [{ kind: "yt", key: r.key, browseId: r.browseId }]
        : [],
  );

/**
 * What one release's songs do once read, in the section's order: the first with songs plays,
 * replacing the queue; each later one joins its end while the queue is still this play's
 * ([context] is the queue's now, [id] this play's); a release with no songs, or that couldn't
 * be read ([songs] null), is left out; once the queue is something else, the rest stop.
 */
export const followPlayStep = (
  state: {
    readonly started: boolean;
    readonly context: QueueContext | null;
    readonly id: string;
  },
  songs: number | null,
): "play" | "append" | "skip" | "stop" => {
  if (
    state.started &&
    (state.context?.kind !== FOLLOW_PLAY_CONTEXT || state.context.id !== state.id)
  )
    return "stop";
  if (songs === null || songs === 0) return "skip";
  return state.started ? "append" : "play";
};

/** Up Next's heading over the section's queue ("Up next · from <section>"); null over any other. */
export const followQueueLabel = (
  context: QueueContext | null,
  catalogue: Catalogue = en,
): string | null =>
  context?.kind === FOLLOW_PLAY_CONTEXT
    ? catalogue.playbackText.upNextFrom(catalogue.newReleases.title)
    : null;
