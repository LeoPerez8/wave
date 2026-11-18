// The record a kept full build carries, so a repack's provenance names its native base
// (docs/release-provenance.md). The kept folder holds app-release.apk, without a signature, and
// kept-build.json: the commit and CI run that built it, its native key and the APK's SHA-256.
//   node scripts/ci/kept-build.ts keep <kept dir> <native key> <source sha> <run id>
//   node scripts/ci/kept-build.ts check <kept dir> <native key>   `base=<record>` for $GITHUB_OUTPUT
// `check` prints an empty base when the kept APK has no record, or not the one it names, or
// another native key's: the run then builds in full, as with no kept APK at all.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { digestOf, keptBuild } from "./release-gate.ts";

const APK = "app-release.apk";
const RECORD = "kept-build.json";

const keep = (dir: string, key: string, source: string, run: string) => {
  const record = keptBuild({
    source,
    run: /^\d+$/.test(run) ? Number(run) : undefined,
    key,
    unsignedSha256: digestOf(join(dir, APK)),
  });
  if (!record) throw new Error(`Can't name the kept build: ${source} ${run} ${key}`);
  writeFileSync(join(dir, RECORD), `${JSON.stringify(record)}\n`);
};

/** The kept build's record when it describes this kept APK for this native key, or why not. */
const check = (dir: string, key: string): string => {
  if (!existsSync(join(dir, RECORD))) throw new Error("The kept APK has no record.");
  const record = keptBuild(JSON.parse(readFileSync(join(dir, RECORD), "utf8")));
  if (!record) throw new Error("The kept APK's record is malformed.");
  if (record.key !== key) throw new Error("The kept APK's record is for another native side.");
  if (record.unsignedSha256 !== digestOf(join(dir, APK)))
    throw new Error("The kept APK isn't the one its record names.");
  return JSON.stringify(record);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir = "", key = "", source = "", run = ""] = process.argv.slice(2);
  if (command === "keep") keep(dir, key, source, run);
  else if (command === "check") {
    let base = "";
    try {
      base = check(dir, key);
    } catch (cause) {
      console.error(`No kept build to repack: ${cause instanceof Error ? cause.message : cause}`);
    }
    console.log(`base=${base}`);
  } else throw new Error(`Unknown command: ${command ?? "(none)"}`);
}
