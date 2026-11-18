/**
 * Long lists of video ids (Home's known videos and playlist seed ids) read in
 * pages, so a read doesn't hold the JavaScript thread however long the list is.
 */
import * as Effect from "effect/Effect";

/** Rows of a page: small enough for a phone's JavaScript thread between turns. */
export const VIDEO_PAGE_ROWS = 512;

/** A page's video ids, and where the next page starts; null past the last. */
export interface VideoPage<Cursor> {
  readonly videos: readonly string[];
  readonly next: Cursor | null;
}

/** The ids of a page's rows: a row with no video (not a string, or empty) gives none. */
export const videoIdsOf = (rows: readonly { readonly videoId: unknown }[]): string[] =>
  rows.flatMap(({ videoId }) => (typeof videoId === "string" && videoId !== "" ? [videoId] : []));

/** Every page from [start], each video once, with [between] between pages. */
export const readVideoPages = <Cursor, ReadError, ReadNeeds, TurnError, TurnNeeds>(
  start: Cursor,
  readPage: (cursor: Cursor) => Effect.Effect<VideoPage<Cursor>, ReadError, ReadNeeds>,
  between: Effect.Effect<void, TurnError, TurnNeeds>,
): Effect.Effect<string[], ReadError | TurnError, ReadNeeds | TurnNeeds> =>
  Effect.gen(function* () {
    const videos = new Set<string>();
    let page = yield* readPage(start);
    for (;;) {
      for (const video of page.videos) videos.add(video);
      if (page.next === null) return [...videos];
      yield* between;
      page = yield* readPage(page.next);
    }
  });
