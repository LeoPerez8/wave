import { persistedSetting } from "@/lib/persistedSetting";

/**
 * Offer copied links (Settings › Accounts › Song links), on unless the owner turned it off: coming
 * back to Wave with a song link copied offers to open it (docs/spec.md, "Opening a song link").
 * Off, Wave never reads the clipboard on its own. Each phone's own: never synced.
 */
const offerCopiedLinksSetting = persistedSetting<boolean>({
  key: "settings.offerCopiedLinks",
  read: (stored) => stored !== "off",
  write: (on) => (on ? null : "off"),
});

/** Whether Offer copied links is on. */
export const offerCopiedLinks = offerCopiedLinksSetting.get;

/** Turns Offer copied links on or off. */
export const setOfferCopiedLinks = offerCopiedLinksSetting.set;

/** Whether Offer copied links is on; re-renders when it changes. */
export const useOfferCopiedLinks = offerCopiedLinksSetting.useValue;
