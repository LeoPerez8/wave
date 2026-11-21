import { Database } from "@wave/client";
import { HOME_ARRANGEMENT_SETTING, readHomeArrangementEdit } from "@wave/core";
import { Account } from "./account/accountLayer.ts";
import { editDesktopHome, homeArrangement } from "./homeArrangement.ts";
import * as Effect from "effect/Effect";
import { readHome } from "./library/home.ts";
import { DesktopLibrary } from "./library/library.ts";
import { Playback } from "./playback/playback.ts";
import { syncedPreference } from "./sync/desktopSync.ts";

const view = Effect.gen(function* () {
  const db = yield* Database;
  const library = yield* DesktopLibrary;
  const home = readHome(db, syncedPreference(db, HOME_ARRANGEMENT_SETTING));
  return {
    ...home,
    items: home.items.map((section) => ({
      ...section,
      rows: {
        ...section.rows,
        items: section.rows.items.map((row) => ({
          ...row,
          unavailable: row.path !== null && library.unavailable(row.path),
        })),
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
      if (chosen.unavailable)
        return yield* Effect.fail(new Error("[folder-unavailable] Drive is not connected"));
      const playback = yield* Playback;
      yield* Effect.tryPromise({
        try: () =>
          playback.activate(
            rows.map((row) => String(row.id)),
            index,
            { kind: "home", id: section },
          ),
        catch: (error) => error,
      });
    }),
};
