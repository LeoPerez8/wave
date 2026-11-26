import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DOWNLOAD_WIFI_ONLY_SETTING,
  downloadWaitsForWifi,
  downloadsWaitingForWifi,
  catalogueOf,
  readDownloadWifiOnly,
  writeDownloadWifiOnly,
  wifiWaitLine,
  wifiWaitPlayed,
  ytDownloadLine,
  ytDownloadsFromJournal,
} from "./index.ts";
import type { YtDownloadJournalJob, YtSong } from "./index.ts";

const song = (videoId: string): YtSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Artist"],
  album: null,
  durationMs: null,
  artworkUrl: null,
  explicit: false,
});

const job = (videoId: string, patch: Partial<YtDownloadJournalJob> = {}): YtDownloadJournalJob => ({
  id: videoId,
  song: song(videoId),
  phase: "queued",
  ...patch,
});

const pt = catalogueOf("pt-BR");
const metered = { wifiOnly: true, metered: true };

describe("Download only on Wi-Fi", () => {
  test("on a metered network with the switch on, a download waits", () => {
    assert.equal(downloadWaitsForWifi(metered, { source: "youtube" }), true);
    assert.equal(downloadWaitsForWifi(metered, { source: "soulseek" }), true);
  });

  test("on an unmetered network it runs", () => {
    assert.equal(
      downloadWaitsForWifi({ wifiOnly: true, metered: false }, { source: "youtube" }),
      false,
    );
  });

  test("with the switch off it runs on any network", () => {
    assert.equal(
      downloadWaitsForWifi({ wifiOnly: false, metered: true }, { source: "soulseek" }),
      false,
    );
  });

  test("a tap to play on a metered network runs it, unless it's best quality (Soulseek)", () => {
    assert.equal(downloadWaitsForWifi(metered, { source: "youtube", playNow: true }), false);
    assert.equal(downloadWaitsForWifi(metered, { source: "soulseek", playNow: true }), true);
    // A job from before there was a choice of source is Soulseek's.
    assert.equal(downloadWaitsForWifi(metered, { playNow: true }), true);
  });

  test("the switch is on by default, for new and existing users alike", () => {
    assert.equal(DOWNLOAD_WIFI_ONLY_SETTING, "settings.downloadWifiOnly");
    assert.equal(readDownloadWifiOnly(null), true);
    assert.equal(readDownloadWifiOnly(writeDownloadWifiOnly(true)), true);
    assert.equal(readDownloadWifiOnly(writeDownloadWifiOnly(false)), false);
  });
});

describe("Waiting for Wi-Fi in Settings › Downloads", () => {
  const jobs = [
    job("a", { waitingForWifi: true }),
    job("b", { waitingForWifi: true, phase: "prepared", source: "youtube" }),
    job("c"),
    job("d", { waitingForWifi: true, phase: "failed", reason: "failed" }),
  ];

  test("each waiting row says so", () => {
    const status = ytDownloadsFromJournal(jobs).jobs.map((entry) => entry.status);
    assert.equal(ytDownloadLine(status[0] ?? null), "Waiting for Wi-Fi");
    assert.equal(ytDownloadLine(status[1] ?? null), "Waiting for Wi-Fi");
    assert.equal(ytDownloadLine(status[2] ?? null), "Waiting to download");
    assert.equal(ytDownloadLine(status[0] ?? null, pt), "Aguardando Wi-Fi");
  });

  test("the line at the top counts the songs waiting", () => {
    assert.equal(downloadsWaitingForWifi(jobs), 2);
    assert.equal(wifiWaitLine(jobs), "Waiting for Wi-Fi · 2 songs");
    assert.equal(wifiWaitLine(jobs.slice(0, 1)), "Waiting for Wi-Fi · 1 song");
    assert.equal(wifiWaitLine(jobs, pt), "Aguardando Wi-Fi · 2 músicas");
    assert.equal(wifiWaitLine([job("c")]), null);
  });
});

describe("Playing a song that waits for Wi-Fi", () => {
  const jobs = [
    job("waits", { waitingForWifi: true, source: "youtube", aliases: [song("same")] }),
    job("missing:12", { waitingForWifi: true, source: "youtube" }),
    job("runs", { source: "youtube" }),
  ];

  test("a streamed song names its waiting download, by its own video or one on the job", () => {
    assert.equal(wifiWaitPlayed(jobs, "yt:waits"), "waits");
    assert.equal(wifiWaitPlayed(jobs, "yt:same"), "waits");
  });

  test("a missing song names its own download", () => {
    assert.equal(wifiWaitPlayed(jobs, "12"), "missing:12");
  });

  test("a song not waiting, or no song, names none", () => {
    assert.equal(wifiWaitPlayed(jobs, "yt:runs"), null);
    assert.equal(wifiWaitPlayed(jobs, "13"), null);
    assert.equal(wifiWaitPlayed(jobs, null), null);
  });
});
