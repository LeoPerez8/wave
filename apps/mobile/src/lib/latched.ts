import { useState } from "react";

/** [now], kept true for [key] once it has been: a new [key] starts over. */
export const useLatchedFor = (key: string, now: boolean): boolean => {
  const [latchedFor, setLatchedFor] = useState<string | null>(null);
  if (now && latchedFor !== key) setLatchedFor(key);
  return now || latchedFor === key;
};
