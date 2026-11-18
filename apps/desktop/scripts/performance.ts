import { execFileSync } from "node:child_process";

/** CI's desktop performance limits; elapsed time starts before spawning Electron. */
export function assertWindowReady(elapsedMs: number): void {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= 2000)
    throw new Error(`Window ready in ${elapsedMs} ms; required < 2000 ms`);
}

const percentile = (samples: readonly number[], fraction: number) =>
  [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * fraction) - 1]!;

/** At most 5% missed display opportunities or incomplete viewports, with p95 within 1.5 frames. */
export function assessFrames(
  idleMs: readonly number[],
  scrollMs: readonly number[],
  incompleteFrames: number,
) {
  if (
    idleMs.length < 30 ||
    scrollMs.length < 60 ||
    [...idleMs, ...scrollMs].some((ms) => !Number.isFinite(ms) || ms <= 0) ||
    !Number.isInteger(incompleteFrames) ||
    incompleteFrames < 0 ||
    incompleteFrames > scrollMs.length
  )
    throw new Error("Insufficient or invalid frame samples");
  const displayFrameMs = percentile(idleMs, 0.5);
  // A throttled/background display cannot supply evidence of smooth scrolling.
  if (displayFrameMs > 25) throw new Error("Display is below 40 Hz; performance run is invalid");
  const missed = scrollMs.reduce(
    (sum, ms) => sum + Math.max(0, Math.round(ms / displayFrameMs) - 1),
    0,
  );
  const missedFrameRatio = missed / (scrollMs.length + missed);
  const incompleteFrameRatio = incompleteFrames / scrollMs.length;
  const p95Ms = percentile(scrollMs, 0.95);
  return {
    displayFrameMs,
    p95Ms,
    missedFrames: missed,
    missedFrameRatio,
    incompleteFrameRatio,
    passed:
      p95Ms <= displayFrameMs * 1.5 && missedFrameRatio <= 0.05 && incompleteFrameRatio <= 0.05,
  };
}

export interface ProcessMemory {
  readonly pid: number;
  readonly parentPid: number;
  readonly name: string;
  readonly rssBytes: number;
}

/** OS resident memory for the whole app, including non-Chromium descendants. */
export function processTreeMemory(root: number, snapshot: readonly ProcessMemory[]) {
  if (!snapshot.some((entry) => entry.pid === root)) throw new Error("Missing app process");
  const ids = new Set([root]);
  let added = true;
  while (added) {
    added = false;
    for (const entry of snapshot)
      if (ids.has(entry.parentPid) && !ids.has(entry.pid)) {
        ids.add(entry.pid);
        added = true;
      }
  }
  const processes = snapshot.filter((entry) => ids.has(entry.pid)).sort((a, b) => a.pid - b.pid);
  return { processes, totalRssBytes: processes.reduce((sum, entry) => sum + entry.rssBytes, 0) };
}

export function readProcessMemory(): ProcessMemory[] {
  const options = { encoding: "utf8" as const, timeout: 15000, windowsHide: true };
  if (process.platform === "win32") {
    // Enumerate once, so each process's parent and working set belong to the same snapshot.
    const json = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize | ConvertTo-Json -Compress",
      ],
      options,
    );
    return (
      JSON.parse(json) as {
        ProcessId: number;
        ParentProcessId: number;
        Name: string;
        WorkingSetSize: number;
      }[]
    ).map((entry) => ({
      pid: entry.ProcessId,
      parentPid: entry.ParentProcessId,
      name: entry.Name,
      rssBytes: Number(entry.WorkingSetSize),
    }));
  }
  if (process.platform !== "linux")
    throw new Error("Performance runner supports Windows and Linux");
  return execFileSync("ps", ["-eo", "pid=,ppid=,rss=,comm="], options)
    .trim()
    .split("\n")
    .map((line) => {
      const [, pid, parentPid, kib, name] = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)!;
      return {
        pid: Number(pid),
        parentPid: Number(parentPid),
        rssBytes: Number(kib) * 1024,
        name: name!,
      };
    });
}
