/** One active background job; cancellation keeps the next job behind the active job's cleanup. */
export const createSerialWork = () => {
  type Job = {
    key: string;
    controller: AbortController;
    run: (signal: AbortSignal) => Promise<void>;
  };
  const queue: Job[] = [];
  let active: Job | null = null;
  let disposed = false;
  const pump = () => {
    if (disposed || active !== null) return;
    const job = queue.shift();
    if (job === undefined) return;
    active = job;
    void Promise.resolve()
      .then(() => (job.controller.signal.aborted ? undefined : job.run(job.controller.signal)))
      .catch(() => {})
      .finally(() => {
        active = null;
        pump();
      });
  };
  return {
    add: (key: string, run: Job["run"]): (() => void) => {
      if (
        disposed ||
        (active?.key === key && !active.controller.signal.aborted) ||
        queue.some((job) => job.key === key)
      )
        return () => {};
      const job = { key, run, controller: new AbortController() };
      queue.push(job);
      pump();
      return () => {
        job.controller.abort();
        const at = queue.indexOf(job);
        if (at >= 0) queue.splice(at, 1);
      };
    },
    dispose: () => {
      disposed = true;
      for (const job of queue.splice(0)) job.controller.abort();
      active?.controller.abort();
    },
  };
};
