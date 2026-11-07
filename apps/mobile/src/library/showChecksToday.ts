import { persistedSetting } from "@/lib/persistedSetting";

/**
 * The artists show checks asked Ticketmaster about on [day] (a UTC day,
 * Core's `showCheckDay`), so a check stops at the service's daily limit
 * without asking (`showChecksLeftToday`). Null before any. Never synced: the
 * service counts per account, and a second phone only finds its limit sooner.
 */
export const showChecksToday = persistedSetting<{ day: number; count: number } | null>({
  key: "shows.checksToday",
  read: (stored) => {
    if (stored === null) return null;
    try {
      const { day, count } = JSON.parse(stored) as { day?: unknown; count?: unknown };
      return typeof day === "number" && typeof count === "number" ? { day, count } : null;
    } catch {
      return null;
    }
  },
  write: (value) => (value === null ? null : JSON.stringify(value)),
  equals: (a, b) => a?.day === b?.day && a?.count === b?.count,
});
