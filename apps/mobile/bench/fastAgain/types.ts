import type { FastAgainFixture } from "../../src/library/db/fastAgainFixture.ts";
import type { MeasureOptions } from "./measure.ts";

export type BenchVariant = "after" | "before" | "reference";
export interface ReadMeasurement {
  readonly read: string;
  readonly status?: "ok";
  readonly medianMs: number;
  readonly p90Ms: number;
  /** Mean process CPU time per measured run. */
  readonly cpuMs: number;
  /** Rows returned by SQL, including intermediate results; not SQLite VM visits. */
  readonly rowsRead: number;
  readonly statements: number;
  readonly longestSyncTaskMs: number;
  readonly notifications: number;
  /** Optional semantic result identity, compared across variants. */
  readonly resultKey?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}
export interface UnavailableMeasurement {
  readonly read: string;
  readonly status: "unavailable";
  readonly reason: string;
}
export type BenchMeasurement = ReadMeasurement | UnavailableMeasurement;
export interface FastAgainContext {
  readonly fixture: FastAgainFixture;
  readonly variant: BenchVariant;
  readonly root: string;
  readonly runs: number;
  readonly loadModule: <A = Record<string, unknown>>(relativePath: string) => Promise<A>;
  readonly measure: <A>(read: string, run: () => A, options?: MeasureOptions<A>) => ReadMeasurement;
}
export interface FastAgainBench {
  readonly name: string;
  readonly run: (context: FastAgainContext) => Promise<readonly BenchMeasurement[]>;
}
