import { Database } from "@wave/client";
import type { LibraryDatabase } from "@wave/client/db/database";
import { homePlays } from "@wave/client/db/playHistory";
import {
  HOME_ARRANGEMENT_SETTING,
  readHomeArrangementEdit,
  ytTrackId,
  type YtAlbumSong,
} from "@wave/core";
import { HOME_SEE_ALL_SECTIONS, type HomeRow } from "../shared/home.ts";
import { Account } from "./account/accountLayer.ts";
import { editDesktopHome, homeArrangement } from "./homeArrangement.ts";
import * as Effect from "effect/Effect";
import { readHome } from "./library/home.ts";
import { readHomeSeeAll } from "./library/homeSeeAll.ts";
import { DesktopLibrary } from "./library/library.ts";
import { Playback } from "./playback/playback.ts";
import { recapToAnnounceNow } from "./library/recaps.ts";
import { syncedPreference } from "./sync/desktopSync.ts";
import { YtMusic } from "./yt/ytMusic.ts";

/** The queue key of a Home row: a Library song's id, or a streamed song's `yt:` id. */
const queueKey = (row: HomeRow) =>
  row.videoId === undefined ? String(row.id) : ytTrackId(row.videoId);

/** The streamed songs among [rows], as Most played read them, for the player. */
const streamedSongs = (db: LibraryDatabase, rows: readonly HomeRow[]): YtAlbumSong[] => {
  const ids = new Set(rows.flatMap((row) => (row.videoId === undefined ? [] : [row.videoId])));
  return ids.size === 0
    ? []
    : homePlays(db).mostPlayed.flatMap((row) =>
        row.source === "stream" && ids.has(row.song.videoId) ? [row.song] : [],
      );
};

const view = Effect.gen(function* () {
  const db = yield* Database;
  const library = yield* DesktopLibrary;
  const yt = yield* YtMusic;
  const ytEnabled = yt.enabled();
  const home = readHome(db, syncedPreference(db, HOME_ARRANGEMENT_SETTING));
  const streamed = home.items.flatMap((s) => (s.id === "most-played" ? s.rows.items : []));
  // Kept so their menu and a play can name them; with YouTube Music off they stay offline.
  if (ytEnabled) yt.keep(streamedSongs(db, streamed));
  return {
    ...home,
    recap: recapToAnnounceNow(db),
    items: home.items.map((section) => ({
      ...section,
      rows: {
        ...section.rows,
        items: section.rows.items.map((row) =>
          row.videoId === undefined
            ? { ...row, unavailable: row.path !== null && library.unavailable(row.path) }
            : // A streamed song plays, and shows its cover, only with YouTube Music on.
              { ...row, unavailable: !ytEnabled, artworkUrl: ytEnabled ? row.artworkUrl : null },
        ),
      },
    })),
  };
});

/** Home accepts a section and a position, never arbitrary paths or a queue from the renderer. */
export const homeHandlers = {
  "home.view": () => view,
  "home.arrangement": () => Effect.map(Database, homeArrangement),
  "home.edit": ([raw]: readonly unknown[]) =>
    Effect.gen(function* () {
      const edit = readHomeArrangementEdit(raw);
      if (edit === null) return yield* Effect.fail(new Error("Refused home.edit: invalid edit"));
      const arrangement = editDesktopHome(yield* Database, edit);
      (yield* Account).settingsEdited();
      return arrangement;
    }),
  "home.play": ([section, index]: readonly unknown[]) =>
    Effect.gen(function* () {
      if (
        (section !== "most-played" && section !== "favorites") ||
        typeof index !== "number" ||
        !Number.isSafeInteger(index) ||
        index < 0
      )
        return yield* Effect.fail(new Error("Refused home.play: invalid section or position"));
      const home = yield* view;
      const rows = home.items.find((s) => s.id === section)?.rows.items ?? [];
      const chosen = rows[index];
      if (!chosen)
        return yield* Effect.fail(new Error("Refused home.play: position outside section"));
      if (chosen.videoId !== undefined && chosen.unavailable)
        return yield* Effect.fail(new Error("Refused home.play: YouTube Music is off"));
      if (chosen.unavailable)
        return yield* Effect.fail(new Error("[folder-unavailable] Drive is not connected"));
      const playback = yield* Playback;
      const yt = yield* YtMusic;
      // With YouTube Music off, streamed rows stay out of the queue.
      const queue = rows.filter((row) => row.videoId === undefined || !row.unavailable);
      const streams = streamedSongs(yield* Database, queue);
      const play = () =>
        playback.activate(queue.map(queueKey), queue.indexOf(chosen), {
          kind: "home",
          id: section,
        });
      yield* Effect.tryPromise({
        try: () => (streams.length === 0 ? play() : yt.withSongs(streams, play)),
        catch: (error) => error,
      });
    }),
  "home.seeAll": ([section]: readonly unknown[]) =>
    Effect.gen(function* () {
      const known = HOME_SEE_ALL_SECTIONS.find((id) => id === section);
      if (known === undefined)
        return yield* Effect.fail(new Error("Refused home.seeAll: invalid section"));
      const db = yield* Database;
      const library = yield* DesktopLibrary;
      const items = readHomeSeeAll(db, known).map((row) => ({
        ...row,
        unavailable: row.path !== null && library.unavailable(row.path),
      }));
      return { items, offset: 0, total: items.length };
    }),
};
