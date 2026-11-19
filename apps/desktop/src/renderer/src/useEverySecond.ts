import { useEffect, useRef } from "react";

const EVERY_MS = 1_000;

/**
 * Asks main with [read] and hands the answer to [apply], now and a second after each answer,
 * while the window shows; from the start again when [key] changes. A null [read] asks nothing,
 * and a read that fails is asked again at the next turn.
 */
export function useEverySecond<T>(
  read: () => Promise<T> | null,
  apply: (answer: T) => void,
  key = "",
): void {
  const latest = useRef({ read, apply });
  useEffect(() => {
    latest.current = { read, apply };
  });
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const asked = document.hidden ? null : latest.current.read();
        if (asked !== null) {
          const answer = await asked;
          if (current) latest.current.apply(answer);
        }
      } catch {
        // Main answers again on the next read.
      } finally {
        if (current) timer = setTimeout(() => void poll(), EVERY_MS);
      }
    };
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key]);
}
