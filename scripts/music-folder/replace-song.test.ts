/**
 * The in-place replacement on throwaway files: fake peers stand in for
 * Soulseek, and the real audio.py measures, checks and writes. Needs Python
 * with numpy, miniaudio, mutagen and imageio-ffmpeg; skipped without them.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { SoulseekCandidate } from "../../packages/core/src/index.ts";
import { parseReplaceList, recordingOf, type Probe } from "./replace-plan.ts";
import { pythonAudio, replaceSong, type Peers } from "./replace-song.ts";

const here = dirname(fileURLToPath(import.meta.url));
const python = process.env.PYTHON ?? "python";
const missing =
  spawnSync(python, ["-c", "import numpy, miniaudio, mutagen, imageio_ffmpeg"]).status !== 0;

const sha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/** The tags and cover mutagen reads, to compare a file's before and after. */
const tagsOf = (path: string): Record<string, unknown> => {
  const script = [
    "import json, sys",
    "from mutagen.id3 import ID3",
    "t = ID3(sys.argv[1])",
    "out = {k: str(t[k]) for k in ('TIT2', 'TPE1', 'TALB', 'TCON', 'TRCK') if k in t}",
    "out['lyrics'] = [f.text for f in t.getall('USLT')]",
    "out['covers'] = [f.data.hex() for f in t.getall('APIC')]",
    "print(json.dumps(out))",
  ].join("\n");
  const result = spawnSync(python, ["-I", "-c", script, path], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Record<string, unknown>;
};

/** The bytes between the ID3v2 tag and the ID3v1 tag, as audio.py splits them. */
const audioOf = (path: string): string => {
  const data = readFileSync(path);
  let start = 0;
  if (data.subarray(0, 3).toString("latin1") === "ID3") {
    const size =
      ((data[6]! & 127) << 21) |
      ((data[7]! & 127) << 14) |
      ((data[8]! & 127) << 7) |
      (data[9]! & 127);
    start = 10 + size;
  }
  const end =
    data.subarray(-128, -125).toString("latin1") === "TAG" ? data.length - 128 : data.length;
  return createHash("sha256").update(data.subarray(start, end)).digest("hex");
};

describe(
  "replaceSong",
  { skip: missing && "needs Python with numpy, miniaudio, mutagen and imageio-ffmpeg" },
  () => {
    let fixtures = "";
    let work = "";
    const audio = pythonAudio(python);
    const entry = parseReplaceList("Alternative\tArctic Monkeys - Arabella\n")[0]!;

    before(() => {
      fixtures = mkdtempSync(join(tmpdir(), "wave-replace-fixtures-"));
      const made = spawnSync(python, [join(here, "fixtures.py"), fixtures], { encoding: "utf8" });
      assert.equal(made.status, 0, made.stderr);
    });
    after(() => {
      rmSync(fixtures, { recursive: true, force: true });
    });

    /** A music folder with the old song at `Alternative/Arctic Monkeys - Arabella.mp3`. */
    const setUp = async () => {
      work = mkdtempSync(join(tmpdir(), "wave-replace-"));
      const root = join(work, "Musicas");
      const path = "Alternative/Arctic Monkeys - Arabella.mp3";
      const target = join(root, "Alternative", "Arctic Monkeys - Arabella.mp3");
      spawnSync(python, ["-c", "import os,sys; os.makedirs(sys.argv[1])", dirname(target)]);
      copyFileSync(join(fixtures, "old.mp3"), target);
      const [current] = await audio.probe([target]);
      const recording = recordingOf(
        {
          path,
          sizeBytes: current!.sizeBytes,
          durationMs: current!.durationMs,
          tags: { title: "Arabella", artist: "Arctic Monkeys", album: "AM" },
        },
        entry,
      );
      return { root, path, target, current: current as Probe, recording };
    };

    /** Peers sharing [files] (fixture names), each claiming a 320 kbps, 12-second file. */
    const peers = (files: readonly string[], failing: readonly string[] = []) => {
      const searched: string[] = [];
      const downloaded: string[] = [];
      const reports: SoulseekCandidate[] = files.map((name, i) => ({
        username: `peer${i}-${name}`,
        filename: `Music\\Arctic Monkeys\\AM\\0${i} Arctic Monkeys - Arabella.mp3`,
        bytes: 480_000,
        bitrateKbps: 320,
        durationMs: 12_000,
        freeSlot: true,
        uploadSpeed: 1000 - i,
        queueLength: 0,
      }));
      const fake: Peers = {
        search: async (query) => {
          searched.push(query);
          return reports;
        },
        download: async (peer, part) => {
          const name = peer.username.slice(peer.username.indexOf("-") + 1);
          downloaded.push(name);
          if (failing.includes(name)) return { ok: false, reason: "the peer is unavailable" };
          copyFileSync(join(fixtures, name), part);
          return { ok: true };
        },
      };
      return { fake, searched, downloaded };
    };

    it("replaces the song in place with the first genuine copy, keeping its tags and cover", async () => {
      const song = await setUp();
      const tagsBefore = tagsOf(song.target);
      const { fake, downloaded } = peers(["upscale.mp3", "vbr.mp3", "good.mp3", "longer.mp3"]);
      const outcome = await replaceSong(
        { ...song, entry, work: join(work, "work"), backup: join(work, "originals", song.path) },
        fake,
        audio,
      );

      assert.equal(outcome.outcome, "replaced");
      assert.deepEqual(downloaded, ["upscale.mp3", "vbr.mp3", "good.mp3"]);
      if (outcome.outcome !== "replaced") return;
      assert.equal(outcome.path, song.path);
      assert.ok(outcome.cutoffHz === null || outcome.cutoffHz >= 19_500);
      assert.deepEqual(
        outcome.tried.map((peer) => peer.reason),
        ["upscaled: its spectrum stops at 17.5 kHz", "not 320 kbps in every frame"],
      );
      assert.equal(audioOf(song.target), audioOf(join(fixtures, "good.mp3")));
      assert.deepEqual(tagsOf(song.target), tagsBefore);
      assert.equal(sha(join(work, "originals", song.path)), sha(join(fixtures, "old.mp3")));
      assert.equal(outcome.sha256, sha(song.target));
      assert.deepEqual(readdirSync(dirname(song.target)), ["Arctic Monkeys - Arabella.mp3"]);
      rmSync(work, { recursive: true, force: true });
    });

    it("leaves the song alone when every peer's copy is rejected, saying why", async () => {
      const song = await setUp();
      const { fake } = peers(["upscale.mp3", "longer.mp3", "live.mp3", "vbr.mp3"], ["vbr.mp3"]);
      const outcome = await replaceSong(
        { ...song, entry, work: join(work, "work"), backup: join(work, "originals", song.path) },
        fake,
        audio,
      );

      assert.equal(outcome.outcome, "rejected");
      if (outcome.outcome !== "rejected") return;
      assert.equal(outcome.query, "Arctic Monkeys Arabella");
      assert.deepEqual(
        outcome.tried.map((peer) => peer.reason),
        [
          "upscaled: its spectrum stops at 17.5 kHz",
          "it lasts 0:20, the old file 0:12",
          "its tags name another recording: Arctic Monkeys - Arabella (Live at Glastonbury) (Live)",
          "the peer is unavailable",
        ],
      );
      assert.equal(sha(song.target), sha(join(fixtures, "old.mp3")));
      assert.deepEqual(readdirSync(dirname(song.target)), ["Arctic Monkeys - Arabella.mp3"]);
      rmSync(work, { recursive: true, force: true });
    });

    it("says when nobody has the recording", async () => {
      const song = await setUp();
      const outcome = await replaceSong(
        { ...song, entry, work: join(work, "work"), backup: join(work, "originals", song.path) },
        { search: async () => [], download: async () => assert.fail("nothing to download") },
        audio,
      );
      assert.deepEqual(outcome, {
        outcome: "no-candidates",
        path: song.path,
        query: "Arctic Monkeys Arabella",
        reports: 0,
      });
      rmSync(work, { recursive: true, force: true });
    });

    it("doesn't search for a song whose file already passes", async () => {
      const song = await setUp();
      copyFileSync(join(fixtures, "good.mp3"), song.target);
      const [current] = await audio.probe([song.target]);
      const { fake, searched } = peers(["good.mp3"]);
      const outcome = await replaceSong(
        {
          ...song,
          current: current!,
          entry,
          work: join(work, "work"),
          backup: join(work, "b.mp3"),
        },
        fake,
        audio,
      );
      assert.equal(outcome.outcome, "already-good");
      assert.deepEqual(searched, []);
      rmSync(work, { recursive: true, force: true });
    });

    it("doesn't write over a file that changed since it was measured", async () => {
      const song = await setUp();
      const { fake } = peers(["good.mp3"]);
      const changed = {
        ...song,
        current: { ...song.current, sha256: "0".repeat(64) },
      };
      const outcome = await replaceSong(
        { ...changed, entry, work: join(work, "work"), backup: join(work, "originals", song.path) },
        fake,
        audio,
      );
      assert.equal(outcome.outcome, "failed");
      assert.equal(sha(song.target), sha(join(fixtures, "old.mp3")));
      assert.deepEqual(readdirSync(dirname(song.target)), ["Arctic Monkeys - Arabella.mp3"]);
      rmSync(work, { recursive: true, force: true });
    });
  },
);
