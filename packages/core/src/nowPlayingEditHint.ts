/**
 * Now Playing's edit hint: a toast saying a held button edits the screen,
 * shown the first time Now Playing opens on a phone, fresh installs included,
 * and never again there. Whether it showed is kept on the phone and doesn't
 * sync with the Wave account.
 */

/** What the phone stores once the hint showed. */
const SHOWN = "1";

/** Whether the hint showed on this phone, from what it stores (null when nothing is). */
export const readNowPlayingEditHintShown = (stored: string | null): boolean => stored === SHOWN;

/** What to store for whether the hint showed; nothing (null) until it does. */
export const storedNowPlayingEditHintShown = (shown: boolean): string | null =>
  shown ? SHOWN : null;

/** Whether the hint shows now: Now Playing is open and the hint never showed here. */
export const nowPlayingEditHintDue = (phone: {
  readonly nowPlayingOpen: boolean;
  /** `readNowPlayingEditHintShown`'s answer. */
  readonly shown: boolean;
}): boolean => phone.nowPlayingOpen && !phone.shown;
