/** Which periods have a Recap on this computer, and which of them were opened here. */
import type { LibraryDatabase } from "@wave/client/db/database";
import { countedListening } from "@wave/client/db/stats";
import {
  availableRecaps,
  parseOpenedRecaps,
  recapId,
  recapToAnnounce,
  storedOpenedRecaps,
  withRecapOpened,
  type CountedListening,
  type RecapPeriod,
} from "@wave/core";
import { preference, savePreference } from "../preferences.ts";

/** The Recaps this computer opened, as the phone keeps its own (`recaps.opened`). */
const OPENED_RECAPS = "recaps.opened";
const openedRecaps = (db: LibraryDatabase) =>
  parseOpenedRecaps(preference(db, OPENED_RECAPS) ?? null);

/** Every period with a Recap now, newest first (Core's `availableRecaps`). */
export const recapsNow = (
  db: LibraryDatabase,
  listening: readonly CountedListening[] = countedListening(db),
): RecapPeriod[] => availableRecaps(listening, Date.now());

/** The Recap Home's card announces, or null: the newest one out, until it is opened. */
export const recapToAnnounceNow = (db: LibraryDatabase): RecapPeriod | null =>
  recapToAnnounce(recapsNow(db), openedRecaps(db));

/** Keeps that [period]'s Recap was opened, so Home stops announcing it. */
export const recapOpened = (db: LibraryDatabase, period: RecapPeriod): void =>
  savePreference(
    db,
    OPENED_RECAPS,
    storedOpenedRecaps(withRecapOpened(openedRecaps(db), recapId(period))),
  );
