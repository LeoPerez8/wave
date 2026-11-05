import { makeExternalStore } from "@/lib/externalStore";

/**
 * Bumped when this phone saves a follow, an unfollow, a hidden release, a
 * notified show, or a dismissed follow suggestion or its Undo; the Wave
 * account sync follows it (`startSync`).
 */
export const followsSaved = makeExternalStore(0);

export const followSaved = (): void => followsSaved.update((n) => n + 1);
