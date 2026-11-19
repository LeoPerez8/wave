import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopUpdateLifecycle } from "./lifecycle.ts";

const release = (serial: number) => ({
  channel: "main" as const,
  platform: "win32" as const,
  version: "1.1.0",
  serial,
  rollback: false,
  size: 1,
  sha512: String(serial),
});

test("a ready installer is replaced after advance and skipped after a recall or outage", async () => {
  let latest: ReturnType<typeof release> | null = release(2);
  const downloaded: number[] = [];
  const installed: string[] = [];
  const updater = () =>
    desktopUpdateLifecycle({
      check: async () => latest,
      download: async (manifest) => {
        downloaded.push(manifest.serial);
        return String(manifest.serial);
      },
      latest: async () => {
        if (latest?.serial === 4) throw new Error("offline");
        return latest;
      },
      install: async ({ file }) => {
        installed.push(file);
      },
      report: () => {},
    });
  const advance = updater();
  await advance.check();
  await advance.check();
  latest = release(3);
  await advance.check();
  await advance.quit();
  assert.deepEqual(downloaded, [2, 3]);
  assert.deepEqual(installed, ["3"]);

  for (const next of [null, release(4)]) {
    const recall = updater();
    latest = release(3);
    await recall.check();
    latest = next;
    await recall.quit();
  }
  assert.deepEqual(installed, ["3"]);
});

test("quit uses fresh authorization and ignores a download finishing during quit", async () => {
  let finish!: (file: string) => void;
  let downloading!: () => void;
  const started = new Promise<void>((resolve) => {
    downloading = resolve;
  });
  const updater = desktopUpdateLifecycle({
    check: async () => release(2),
    download: () =>
      new Promise<string>((resolve) => {
        finish = resolve;
        downloading();
      }),
    latest: async () => release(2),
    install: async () => assert.fail("installer was not ready when quitting"),
    report: (error) => assert.fail(String(error)),
  });
  const check = updater.check();
  await started;
  await updater.quit();
  finish("2");
  await check;
  await updater.quit();
});

test("an in-flight periodic check cannot replace quit authorization", async () => {
  let finishCheck!: (manifest: ReturnType<typeof release>) => void;
  const nextCheck = new Promise<ReturnType<typeof release>>((resolve) => {
    finishCheck = resolve;
  });
  let checks = 0;
  let validations = 0;
  const updater = desktopUpdateLifecycle({
    check: async () => (++checks === 1 ? release(2) : nextCheck),
    download: async (manifest) => String(manifest.serial),
    latest: async () => {
      validations++;
      return release(3);
    },
    install: async () => assert.fail("latest points to a different release"),
    report: (error) => assert.fail(String(error)),
  });
  await updater.check();
  const inFlight = updater.check();
  await updater.quit();
  finishCheck(release(2));
  await inFlight;
  assert.equal(validations, 1);
});
