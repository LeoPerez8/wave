import { localDay } from "@wave/core";
import { useEffect, useState } from "react";

/**
 * The local calendar day (Core's `localDay`), changing just after midnight
 * while the caller stays mounted. Home's 14-day lists put it in their query
 * key, so they are read again when the day changes and at no other time.
 */
export const useLocalDay = (): string => {
  const [day, setDay] = useState(() => localDay(Date.now()));

  useEffect(() => {
    const now = Date.now();
    const next = new Date(now);
    next.setHours(24, 0, 1, 0);
    const timer = setTimeout(() => setDay(localDay(Date.now())), next.getTime() - now);
    return () => clearTimeout(timer);
  }, [day]);

  return day;
};

/**
 * [value], or the last one that wasn't undefined while it is: a list read
 * again under a new day's key stays on screen until that read ends.
 */
export const useLastDefined = <A>(value: A | undefined): A | undefined => {
  const [last, setLast] = useState(value);
  if (value !== undefined && value !== last) setLast(value);
  return value ?? last;
};
