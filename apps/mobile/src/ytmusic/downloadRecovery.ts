/** Coalesces completed-download recovery at the end of a run, and after later Library edits. */
export const createDownloadRecovery = <
  J extends {
    readonly id: string;
    readonly generation: number;
    readonly phase: string;
    readonly acknowledged?: boolean;
  },
>(ports: {
  readonly version: () => string;
  readonly read: (jobs: readonly J[]) => Promise<readonly string[]>;
  readonly forget: (id: string, generation: number) => Promise<boolean>;
}) => {
  let reconciled = "";
  let forgotten = new Set<string>();
  return async (jobs: readonly J[], active: boolean): Promise<readonly J[]> => {
    if (active) return jobs;
    const completed = jobs.filter((job) => job.phase === "completed" && job.acknowledged === true);
    if (completed.length === 0) return jobs;
    const version = ports.version();
    const revision = JSON.stringify([version, completed.map((job) => [job.id, job.generation])]);
    if (revision !== reconciled) {
      const ids = await ports.read(completed);
      // A landing or scan during the read needs a new snapshot; never forget against the old one.
      if (version !== ports.version()) return jobs;
      forgotten = new Set();
      const byId = new Map(completed.map((job) => [job.id, job]));
      for (const id of ids) {
        if (version !== ports.version()) return jobs.filter((job) => !forgotten.has(job.id));
        const job = byId.get(id);
        if (job !== undefined && (await ports.forget(id, job.generation))) forgotten.add(id);
      }
      if (version === ports.version()) reconciled = revision;
    }
    return forgotten.size === 0 ? jobs : jobs.filter((job) => !forgotten.has(job.id));
  };
};
