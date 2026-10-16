// The phone over adb: the `Device` the runner uses for real runs.
import { spawn } from "node:child_process";

import type { Device } from "./runner.ts";

const MAX_OUTPUT = 64 * 1024 * 1024;

/** Runs adb with [args]; resolves stdout, whatever the remote command's exit code. */
export const adb = (args: readonly string[], input?: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn("adb", args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => reject(new Error(`Couldn't run adb: ${error.message}`)));
    child.on("close", (code) => {
      // adb's own failures (no device, device offline) print to stderr with no output.
      if (code !== 0 && stdout === "" && /error|not found|offline|unauthorized/i.test(stderr))
        reject(new Error(`adb ${args.join(" ")}: ${stderr.trim()}`));
      else resolve(stdout);
    });
    child.stdin.end(input ?? "");
  });

/** Serials of the devices adb sees, with their state ("device", "offline", "unauthorized"). */
export const listDevices = async (): Promise<{ serial: string; state: string }[]> =>
  (await adb(["devices"]))
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts): parts is [string, string] => parts.length === 2)
    .map(([serial, state]) => ({ serial, state }));

export const adbDevice = (serial: string): Device => ({
  serial,
  shell: (command, input) => adb(["-s", serial, "shell", command], input),
  pull: async (remote, local) => {
    await adb(["-s", serial, "pull", remote, local]);
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

export const installApk = async (serial: string, apk: string): Promise<void> => {
  const output = await adb(["-s", serial, "install", "-r", apk]);
  if (!output.includes("Success")) throw new Error(`Couldn't install ${apk}: ${output.trim()}`);
};
