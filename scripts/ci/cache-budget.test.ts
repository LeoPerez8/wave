import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  BUDGET_BYTES,
  appOf,
  budgetWarnings,
  familyOf,
  superseded,
  usage,
  type CacheEntry,
} from "./cache-budget.ts";

const LOCK = "d067bb6ee6296aa546646a6ecfe73ca769a9a7d49ed33d01d0d67e41cb8c927d";
const SHA = "8b290fbe3d3bc356dbb65b1fef32e8b817fa4156";
const OTHER_SHA = "95b35b964acb6fb36f91478b421ef6901c0ddb41";
const MAIN = "refs/heads/main";

let nextId = 1;
const entry = (key: string, created: string, more: Partial<CacheEntry> = {}): CacheEntry => ({
  id: nextId++,
  key,
  ref: MAIN,
  version: "v1",
  size_in_bytes: 1,
  created_at: `2026-11-21T${created}:00Z`,
  ...more,
});
const keys = (entries: CacheEntry[]) => entries.map((entry) => entry.key).toSorted();

describe("familyOf", () => {
  it("drops the trailing hashes: the inputs' and a commit's", () => {
    assert.equal(familyOf(`mobile-gradle-android-${LOCK}`), "mobile-gradle-android");
    assert.equal(familyOf(`mobile-metro-${LOCK}-${SHA}`), "mobile-metro");
    assert.equal(familyOf(`shared-pnpm-Windows-${LOCK}`), "shared-pnpm-Windows");
    assert.equal(familyOf(`apk-v2-${LOCK}`), "apk-v2");
  });

  it("keeps a key with no hash as it is", () => {
    assert.equal(familyOf("shared-pnpm-Linux-"), "shared-pnpm-Linux-");
  });
});

describe("appOf", () => {
  it("reads the app from the prefix, and counts the kept APKs as the phone's", () => {
    assert.equal(appOf(`mobile-ccache-${LOCK}`), "mobile");
    assert.equal(appOf(`apk-v2-${LOCK}`), "mobile");
    assert.equal(appOf(`desktop-native-Linux-${LOCK}`), "desktop");
    assert.equal(appOf(`shared-pnpm-Linux-${LOCK}`), "shared");
  });

  it("has no app for a key CI doesn't write", () => {
    assert.equal(appOf(`gradle-transforms-v1-${LOCK.slice(0, 32)}`), undefined);
    assert.equal(appOf("someone-else"), undefined);
  });
});

describe("superseded", () => {
  it("keeps the newest entry of each family and deletes the older ones", () => {
    const entries = [
      entry(`mobile-metro-${LOCK}-${SHA}`, "04:00"),
      entry(`mobile-metro-${LOCK}-${OTHER_SHA}`, "05:00"),
      entry(`mobile-gradle-android-${LOCK}`, "03:00"),
      entry(`mobile-gradle-tests-${LOCK}`, "02:00"),
    ];
    assert.deepEqual(keys(superseded(entries)), [`mobile-metro-${LOCK}-${SHA}`]);
  });

  it("supersedes an entry whose inputs changed", () => {
    const older = `mobile-gradle-android-${"a".repeat(64)}`;
    const entries = [entry(older, "03:00"), entry(`mobile-gradle-android-${LOCK}`, "04:00")];
    assert.deepEqual(keys(superseded(entries)), [older]);
  });

  it("keeps one kept APK, the newest: an older native key falls back to its artifact", () => {
    const older = `apk-v2-${"b".repeat(64)}`;
    const entries = [entry(older, "03:00"), entry(`apk-v2-${LOCK}`, "04:00")];
    assert.deepEqual(keys(superseded(entries)), [older]);
  });

  it("keeps each system's entry apart", () => {
    const entries = [
      entry(`desktop-native-Linux-${LOCK}`, "03:00"),
      entry(`desktop-native-Windows-${LOCK}`, "04:00"),
      entry(`shared-pnpm-Linux-${LOCK}`, "03:00"),
      entry(`shared-pnpm-Windows-${LOCK}`, "04:00"),
    ];
    assert.deepEqual(superseded(entries), []);
  });

  it("keeps entries of the same key whose paths differ (another version)", () => {
    const entries = [
      entry(`desktop-gradle-Linux-${LOCK}`, "03:00", { version: "a" }),
      entry(`desktop-gradle-Linux-${LOCK}`, "04:00", { version: "b" }),
    ];
    assert.deepEqual(superseded(entries), []);
  });

  it("judges each ref on its own", () => {
    const entries = [
      entry(`mobile-metro-${LOCK}-${SHA}`, "05:00", { ref: "refs/pull/12/merge" }),
      entry(`mobile-metro-${LOCK}-${OTHER_SHA}`, "04:00"),
    ];
    assert.deepEqual(superseded(entries), []);
  });

  it("deletes every entry of the caches CI no longer writes", () => {
    const retired = [
      `gradle-transforms-v1-${LOCK.slice(0, 32)}`,
      `gradle-home-v1|Linux-X64|android[b8a35c2f917259958c9abe8f2ff1b5ff]-${SHA}`,
      `ccache-android-v2-${LOCK}-${SHA}`,
      `metro-Linux-${LOCK}-${SHA}`,
      `node-cache-Linux-x64-pnpm-${LOCK}`,
    ];
    assert.deepEqual(
      keys(superseded(retired.map((key) => entry(key, "04:00")))),
      retired.toSorted(),
    );
  });

  it("leaves keys it doesn't know alone", () => {
    assert.deepEqual(superseded([entry("someone-else-cache", "04:00")]), []);
  });

  it("breaks a tie on the creation time by the newer id", () => {
    const first = entry(`mobile-metro-${LOCK}-${SHA}`, "04:00");
    const second = entry(`mobile-metro-${LOCK}-${OTHER_SHA}`, "04:00");
    assert.deepEqual(superseded([second, first]), [first]);
  });
});

describe("usage and budgetWarnings", () => {
  const GB = 1024 ** 3;

  it("adds each app's entries up, and the rest as other", () => {
    const entries = [
      entry(`mobile-gradle-android-${LOCK}`, "04:00", { size_in_bytes: 2 * GB }),
      entry(`apk-v2-${LOCK}`, "04:00", { size_in_bytes: GB }),
      entry(`desktop-native-Linux-${LOCK}`, "04:00", { size_in_bytes: GB }),
      entry(`shared-pnpm-Linux-${LOCK}`, "04:00", { size_in_bytes: GB }),
      entry("someone-else", "04:00", { size_in_bytes: 5 }),
    ];
    assert.deepEqual(usage(entries), {
      mobile: 3 * GB,
      desktop: GB,
      shared: GB,
      other: 5,
    });
  });

  it("warns about an app over its budget and a total near the repository's limit", () => {
    assert.deepEqual(budgetWarnings({ mobile: GB, desktop: GB, shared: GB, other: 0 }), []);
    const over = budgetWarnings({
      mobile: BUDGET_BYTES.mobile + 1,
      desktop: 0,
      shared: 0,
      other: 0,
    });
    assert.equal(over.length, 1);
    assert.match(over[0]!, /mobile/);
    const near = budgetWarnings({ mobile: 5 * GB, desktop: 2 * GB, shared: GB, other: 2 * GB });
    assert.equal(near.length, 1);
    assert.match(near[0]!, /9\.5 GB/);
  });
});

// The rules every workflow keeps (docs/spec.md, Build and CI › Caches), so that PR runs only read
// the cache, main writes it, and each entry has a family the prune job knows.
describe("the workflows' caches", () => {
  const dir = new URL("../../.github/", import.meta.url);
  const files = [
    ...readdirSync(new URL("workflows/", dir))
      .filter((name) => /\.ya?ml$/.test(name))
      .map((name) => `workflows/${name}`),
    "actions/pnpm-store/action.yml",
  ];
  const text = Object.fromEntries(
    files.map((file) => [file, readFileSync(new URL(file, dir), "utf8")]),
  );
  /** Every step of every file, as its text from its `- ` line to the next one's. */
  const steps = files.flatMap((file) =>
    text[file]!.split(
      /\n(?=\s*- (?:name|uses|id|if|run|with|env|shell|working-directory|continue-on-error):)/,
    )
      .slice(1)
      .map((step) => ({ file, step })),
  );
  const using = (action: RegExp) =>
    steps.filter(({ step }) => action.test(/uses: (\S+)/.exec(step)?.[1] ?? ""));
  const label = (file: string, step: string) => `${file}: ${step.trim().split("\n")[0]}`;
  const indentOf = (line: string) => /^ */.exec(line)![0].length;
  /** A step's restore-keys, inline or as a block of more indented lines. */
  const restoreKeys = (step: string) => {
    const lines = step.split("\n");
    const at = lines.findIndex((line) => /^\s*restore-keys:/.test(line));
    if (at < 0) return [];
    const inline = lines[at]!.replace(/^\s*restore-keys:\s*/, "");
    if (inline !== "" && inline !== "|") return [inline];
    const block = [];
    for (const line of lines.slice(at + 1)) {
      if (line.trim() === "" || indentOf(line) <= indentOf(lines[at]!)) break;
      block.push(line.trim());
    }
    return block;
  };

  it("restore or save, never actions/cache's own save at the end of a job", () => {
    assert.deepEqual(
      using(/^actions\/cache@/).map(({ file, step }) => label(file, step)),
      [],
    );
  });

  it("save only on main", () => {
    const saves = using(/^actions\/cache\/save@/);
    assert.ok(saves.length > 0);
    for (const { file, step } of saves)
      assert.match(
        /\n\s*if: (.*)/.exec(step)?.[1] ?? "",
        /github\.ref == 'refs\/heads\/main'/,
        label(file, step),
      );
  });

  it("key every entry by app, or by the kept APK's native key", () => {
    for (const { file, step } of using(/^actions\/cache\/(restore|save)@/)) {
      const key = /\n\s*key: (.*)/.exec(step)?.[1] ?? "";
      assert.match(
        key,
        /^(?:(?:mobile|desktop|shared)-|\$\{\{ steps\.(?:key\.outputs\.key|\w+\.outputs\.cache-primary-key) \}\}$)/,
        label(file, step),
      );
      for (const restore of restoreKeys(step))
        assert.match(restore, /^(mobile|desktop|shared)-/, label(file, step));
    }
  });

  it("leave Gradle's and Node's own caching off: the workflows key them by app", () => {
    for (const { file, step } of using(/^gradle\/actions\/setup-gradle@/))
      assert.match(step, /\n\s*cache-disabled: true\b/, label(file, step));
    for (const { file, step } of using(/^actions\/setup-node@/)) {
      assert.match(step, /\n\s*package-manager-cache: false\b/, label(file, step));
      assert.doesNotMatch(step, /\n\s*cache:/, label(file, step));
    }
  });

  it("save the pnpm store from one job per system, after a whole install", () => {
    const savers = steps
      .filter(({ step }) => /uses: \.\/\.github\/actions\/pnpm-store\b/.test(step))
      .filter(({ step }) => /\n\s*save: /.test(step))
      .map(({ file, step }) => `${file}: ${/\n\s*save: (.*)/.exec(step)![1]}`);
    assert.deepEqual(savers, ["workflows/ci.yml: true", "workflows/desktop.yml: true"]);
  });

  // A call whose save is false restores the store, so one after the install would restore it again.
  it("save the desktop's pnpm store on Windows alone, with no second restore on Linux", () => {
    const [saver, ...others] = steps.filter(
      ({ file, step }) =>
        file === "workflows/desktop.yml" &&
        /uses: \.\/\.github\/actions\/pnpm-store\b/.test(step) &&
        /\n\s*save: /.test(step),
    );
    assert.equal(others.length, 0);
    assert.match(saver!.step, /\n\s*if: runner\.os == 'Windows'\n/);
  });
});
