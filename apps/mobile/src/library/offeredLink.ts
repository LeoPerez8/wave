import { offeredLinkKey } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

/**
 * The link Wave offered last from the clipboard (Core's `CopiedLinkOffer.key`), kept so a restart
 * doesn't offer it again. A link Wave copied itself, or that a share or a tap opened it with,
 * counts as offered.
 */
const lastOffered = persistedSetting<string | null>({
  key: "songLinks.lastOffered",
  read: (stored) => stored,
  write: (key) => key,
});

/** The key of the link offered last, or null. */
export const lastOfferedLink = lastOffered.get;

/** Keeps [key] as the link offered last. */
export const keepOfferedLink = lastOffered.set;

/** Counts the link in [text] as offered (Copy Link, a share, a tap); text without one changes nothing. */
export const markLinkOffered = (text: string): void => {
  const key = offeredLinkKey(text);
  if (key !== null) lastOffered.set(key);
};
