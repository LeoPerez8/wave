/**
 * Replacing one song (issue #161): search, try peers in Core's order, check each
 * download, and write the first genuine copy over the old file in place. The
 * network (Peers) and the audio work (Audio) come in from outside, so tests run
 * it with fake peers on throwaway files.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SoulseekCandidate } from "../../packages/core/src/index.ts";
import {
  judgeDownload,
  nextPeers,
  reaches,
  type ListEntry,
  type Outcome,
  type Probe,
  type Recording,
  type TriedPeer,
} from "./replace-plan.ts";

/** Soulseek, as the job needs it. */
export interface Peers {
  /** Peer reports for a query: untrusted claims, filtered by Core. */
  search(query: string): Promise<SoulseekCandidate[]>;
  /** Downloads a peer's file to [part]. A peer that fails says why. */
  download(
    peer: SoulseekCandidate,
    part: string,
    expectedDurationMs: number,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;
}

export interface ReplaceRequest {
  /** The old file, absolute. */
  readonly target: string;
  /** The accepted download, absolute. */
  readonly audio: string;
  /** The old file's SHA-256 when it was measured: it isn't written over if it changed. */
  readonly expectedSha256: string;
  /** Where the old file is copied first, outside the music folder. */
  readonly backup: string;
}

export type ReplaceResult =
  | {
      readonly ok: true;
      readonly sizeBefore: number;
      readonly sizeAfter: number;
      readonly sha256: string;
    }
  | { readonly ok: false; readonly error: string };

/** The audio work, done by audio.py. */
export interface Audio {
  probe(paths: readonly string[]): Promise<Probe[]>;
  replace(request: ReplaceRequest): Promise<ReplaceResult>;
}

const here = dirname(fileURLToPath(import.meta.url));

const runPython = (python: string, args: readonly string[], input: unknown): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const child = spawn(python, ["-I", join(here, "audio.py"), ...args], { stdio: "pipe" });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0)
        reject(new Error(`audio.py ${args[0]} failed: ${Buffer.concat(err).toString("utf8")}`));
      else resolve(JSON.parse(Buffer.concat(out).toString("utf8")));
    });
    child.stdin.end(JSON.stringify(input));
  });

export const pythonAudio = (python: string): Audio => ({
  probe: async (paths) => (await runPython(python, ["probe"], paths)) as Probe[],
  replace: async (request) => (await runPython(python, ["replace"], request)) as ReplaceResult,
});

export interface SongJob {
  readonly entry: ListEntry;
  /** Relative to the music folder. */
  readonly path: string;
  /** The same file, absolute. */
  readonly target: string;
  /** The old file as measured before the run. */
  readonly current: Probe;
  readonly recording: Recording;
  /** A folder outside the music folder for downloads. */
  readonly work: string;
  readonly backup: string;
  /** How many peer files to try at most. */
  readonly maxPeers?: number;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const replaceSong = async (job: SongJob, peers: Peers, audio: Audio): Promise<Outcome> => {
  const { path, current, recording } = job;
  if (current.mp3.ok && reaches(current))
    return { outcome: "already-good", path, cutoffHz: current.cutoffHz };
  if (recording.query === "") return { outcome: "no-candidates", path, query: "", reports: 0 };

  let reports: SoulseekCandidate[];
  try {
    reports = await peers.search(recording.query);
  } catch (error) {
    return { outcome: "failed", path, error: `search: ${message(error)}` };
  }

  const maxPeers = job.maxPeers ?? 10;
  const triedPeers: SoulseekCandidate[] = [];
  const tried: TriedPeer[] = [];
  mkdirSync(job.work, { recursive: true });
  for (;;) {
    const batch = nextPeers(recording.song, reports, triedPeers);
    if (batch.length === 0 || triedPeers.length >= maxPeers) break;
    for (const peer of batch) {
      if (triedPeers.length >= maxPeers) break;
      triedPeers.push(peer);
      const reject = (reason: string): void => {
        tried.push({ username: peer.username, filename: peer.filename, reason });
      };
      const part = join(job.work, `download-${triedPeers.length}.mp3`);
      try {
        const got = await peers.download(peer, part, recording.song.durationMs ?? 0);
        if (!got.ok) {
          reject(got.reason);
          continue;
        }
        const [probe] = await audio.probe([part]);
        if (probe === undefined) throw new Error("audio.py measured nothing");
        const judgement = judgeDownload(recording.song, probe);
        if (!judgement.accepted) {
          reject(judgement.reason);
          continue;
        }
        const written = await audio.replace({
          target: job.target,
          audio: part,
          expectedSha256: current.sha256,
          backup: job.backup,
        });
        if (!written.ok) return { outcome: "failed", path, error: written.error };
        return {
          outcome: "replaced",
          path,
          cutoffHz: judgement.cutoffHz,
          peer: { username: peer.username, filename: peer.filename },
          tried,
          sizeBefore: written.sizeBefore,
          sizeAfter: written.sizeAfter,
          sha256: written.sha256,
        };
      } catch (error) {
        reject(message(error));
      } finally {
        rmSync(part, { force: true });
      }
    }
  }
  if (tried.length === 0)
    return { outcome: "no-candidates", path, query: recording.query, reports: reports.length };
  return { outcome: "rejected", path, query: recording.query, tried };
};
