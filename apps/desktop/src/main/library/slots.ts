/** At most [limit] tasks run at once; the others wait their turn, first come first served. */
export const slots = (limit: number) => {
  const waiting: (() => void)[] = [];
  let running = 0;
  return async <A>(task: () => Promise<A>): Promise<A> => {
    // A task that waited is handed the slot of the one that ended, so the count never drops between them.
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
};
