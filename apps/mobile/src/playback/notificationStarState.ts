import { makeExternalStore } from "@/lib/externalStore";

/**
 * Whether the media notification's Favorite button shows a filled star: the playing song is a
 * favorite (`startNotificationStar` keeps it). The queue sends it to the player with shuffle.
 */
export const notificationStarred = makeExternalStore(false);

let onTap: () => Promise<void> = () => Promise.resolve();

/** What a tap on the notification's Favorite button does (`startNotificationStar` sets it). */
export const handleNotificationStarTap = (tap: () => Promise<void>): void => {
  onTap = tap;
};

/** A tap on the notification's (or Android Auto's) Favorite button. */
export const tapNotificationStar = (): Promise<void> => onTap();
