/**
 * What the replayed-read benches share: the read connection replayed over [db], and every
 * replay step timed (a pass, a step of mapping rows or a slice of steps), as the app's block
 * log names it "Library read replay".
 */
import { performance } from "node:perf_hooks";

import * as offThread from "@wave/client/db/offThreadReads";
import { asyncReadClient, type TestDatabase } from "@wave/client/testing";

/** Starts timing replay steps into `steps` (empty it before each run) and opens [db]'s connection. */
export const timedReplays = (db: TestDatabase) => {
  const steps: number[] = [];
  offThread.runReplayPassesWith((run) => {
    const start = performance.now();
    try {
      return run();
    } finally {
      steps.push(performance.now() - start);
    }
  });
  const connection = offThread.readConnections(async () => asyncReadClient(db));
  const now = () => performance.now();
  return { steps, connection, now };
};
