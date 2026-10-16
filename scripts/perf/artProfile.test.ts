import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { crc32, deflateRawSync, deflateSync } from "node:zlib";

import {
  decodeBinaryProfile,
  checkApkProfile,
  formatProfile,
  looksMinified,
  mergeProfiles,
  parseProfileText,
  readApkProfile,
} from "./artProfile.ts";

const testdata = (name: string): Buffer =>
  readFileSync(new URL(`./testdata/${name}`, import.meta.url));

describe("decodeBinaryProfile", () => {
  // The `assets/dexopt/baseline.prof` AGP 9.2.1 wrote for a Wave release APK (R8 on). Its
  // human-readable source (AGP's combined_art_profile) has 291 class rules, 562 `HSP` method
  // rules and 75 `P` ones, all in classes.dex.
  it("reads the classes and methods of an AGP-written profile", () => {
    const profile = decodeBinaryProfile(testdata("agp-release-baseline.prof"));
    assert.equal(profile.version, "010");
    assert.equal(profile.dexes.length, 1);
    const [dex] = profile.dexes;
    assert.equal(dex?.key.endsWith("classes.dex"), true);
    assert.equal(dex?.classes.length, 291);
    assert.equal(dex?.hot.length, 562);
    assert.equal(dex?.startup.length, 562);
    assert.equal(dex?.postStartup.length, 637);
  });

  it("refuses a file that isn't an ART profile", () => {
    assert.throws(
      () => decodeBinaryProfile(Buffer.from("PK\u0003\u0004 not a profile")),
      /profile/,
    );
  });
});

// ---------------------------------------------------------------------------
// A small APK, built byte by byte from the dex and zip specs.

const uleb = (value: number): number[] => {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
};

/** A dex with one class, `com.example.Foo`, and two methods: `<init>()V` and `bar(I)V`. */
const tinyDex = (): Buffer => {
  const strings = ["<init>", "I", "Lcom/example/Foo;", "V", "VI", "bar"];
  const types = [1, 2, 3]; // I, Lcom/example/Foo;, V (string indexes, sorted)
  const stringIds = 0x70;
  const typeIds = stringIds + strings.length * 4;
  const protoIds = typeIds + types.length * 4;
  const methodIds = protoIds + 2 * 12;
  const typeList = methodIds + 2 * 8;
  const data = typeList + 8;
  const stringData: number[] = [];
  const stringOffsets = strings.map((value) => {
    const offset = data + stringData.length;
    stringData.push(...uleb(value.length), ...Buffer.from(value, "utf8"), 0);
    return offset;
  });
  const dex = Buffer.alloc(data + stringData.length);
  dex.write("dex\n035\0", 0, "latin1");
  dex.writeUInt32LE(dex.length, 0x20);
  dex.writeUInt32LE(strings.length, 0x38);
  dex.writeUInt32LE(stringIds, 0x3c);
  dex.writeUInt32LE(types.length, 0x40);
  dex.writeUInt32LE(typeIds, 0x44);
  dex.writeUInt32LE(2, 0x48);
  dex.writeUInt32LE(protoIds, 0x4c);
  dex.writeUInt32LE(2, 0x58);
  dex.writeUInt32LE(methodIds, 0x5c);
  stringOffsets.forEach((offset, i) => dex.writeUInt32LE(offset, stringIds + i * 4));
  types.forEach((string, i) => dex.writeUInt32LE(string, typeIds + i * 4));
  // proto 0: ()V, shorty "V"; proto 1: (I)V, shorty "VI".
  dex.writeUInt32LE(3, protoIds);
  dex.writeUInt32LE(2, protoIds + 4);
  dex.writeUInt32LE(0, protoIds + 8);
  dex.writeUInt32LE(4, protoIds + 12);
  dex.writeUInt32LE(2, protoIds + 16);
  dex.writeUInt32LE(typeList, protoIds + 20);
  dex.writeUInt32LE(1, typeList);
  dex.writeUInt16LE(0, typeList + 4);
  // method 0: Foo.<init>()V; method 1: Foo.bar(I)V.
  dex.writeUInt16LE(1, methodIds);
  dex.writeUInt16LE(0, methodIds + 2);
  dex.writeUInt32LE(0, methodIds + 4);
  dex.writeUInt16LE(1, methodIds + 8);
  dex.writeUInt16LE(1, methodIds + 10);
  dex.writeUInt32LE(5, methodIds + 12);
  Buffer.from(stringData).copy(dex, data);
  return dex;
};

/** A 010 profile for tinyDex, whose CRC-32 is [checksum]: class Foo; `<init>` hot, startup and post-startup; `bar` post-startup. */
const tinyProfile = (key: string, checksum: number): Buffer => {
  const keyBytes = Buffer.from(key, "utf8");
  const header = Buffer.alloc(16);
  header.writeUInt16LE(keyBytes.length, 0);
  header.writeUInt16LE(1, 2); // one class
  header.writeUInt32LE(4, 4); // one hot method
  header.writeUInt32LE(checksum, 8);
  header.writeUInt32LE(2, 12); // two methods in the dex
  const hot = Buffer.from([0, 0, 0, 0]); // method 0, no inline caches
  const classes = Buffer.from([1, 0]); // type 1
  // Bits 0-1 startup, 2-3 post-startup: <init> startup (0) and post-startup (2), bar post-startup (3).
  const bitmap = Buffer.from([0b1101]);
  const body = Buffer.concat([header, keyBytes, hot, classes, bitmap]);
  const compressed = deflateSync(body);
  const sizes = Buffer.alloc(9);
  sizes.writeUInt8(1, 0);
  sizes.writeUInt32LE(body.length, 1);
  sizes.writeUInt32LE(compressed.length, 5);
  return Buffer.concat([Buffer.from("pro\u0000010\u0000", "latin1"), sizes, compressed]);
};

/** A zip with [entries], each deflated, the way an APK stores most files. */
const zip = (entries: Record<string, Buffer>): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = deflateRawSync(content);
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};

describe("readApkProfile", () => {
  it("names the classes and methods the APK's profile lists", () => {
    const dex = tinyDex();
    const apk = zip({
      "classes.dex": dex,
      "assets/dexopt/baseline.prof": tinyProfile("classes.dex", crc32(dex)),
      "assets/dexopt/baseline.profm": Buffer.from("prm\u0000002\u0000", "latin1"),
    });
    const profile = readApkProfile(apk);
    assert.equal(profile.metadata, true);
    assert.ok(profile.rules !== null);
    assert.equal(
      formatProfile(profile.rules),
      "HSPLcom/example/Foo;-><init>()V\nPLcom/example/Foo;->bar(I)V\nLcom/example/Foo;\n",
    );
  });

  it("says when the APK has no profile", () => {
    const profile = readApkProfile(zip({ "classes.dex": tinyDex() }));
    assert.equal(profile.rules, null);
    assert.equal(profile.metadata, false);
  });

  it("refuses a profile made for other dex files", () => {
    const apk = zip({
      "classes.dex": tinyDex(),
      "assets/dexopt/baseline.prof": tinyProfile("classes.dex", crc32(tinyDex()) + 1),
    });
    assert.throws(() => readApkProfile(apk), /checksum/);
  });
});

/** A profile file's text, one rule per line. */
const text = (...lines: string[]): string => lines.map((line) => `${line}\n`).join("");

describe("parseProfileText", () => {
  it("reads class and method rules, skipping comments and blank lines", () => {
    const { rules, invalid } = parseProfileText(
      "# Baseline profiles for androidx.appcompat\n\nHSPLa/B;->c()V\nLa/B;\r\nPLa/B;->d(I)Z\n",
    );
    assert.deepEqual(invalid, []);
    assert.equal(formatProfile(rules), text("HSPLa/B;->c()V", "PLa/B;->d(I)Z", "La/B;"));
  });

  it("joins the flags of a method listed twice", () => {
    const { rules } = parseProfileText(text("SLa/B;->c()V", "HLa/B;->c()V"));
    assert.equal(formatProfile(rules), text("HSLa/B;->c()V"));
  });

  it("reports lines that aren't rules", () => {
    const { invalid } = parseProfileText(text("HSPLa/B;->c()V", "not a rule", "XLa/B;"));
    assert.deepEqual(invalid, ["not a rule", "XLa/B;"]);
  });
});

describe("checkApkProfile", () => {
  // An R8 build: dev.leoperez.wave.Lib became a.a, Gone was removed, MainActivity kept its name.
  const mapping = text(
    "# compiler: R8",
    "dev.leoperez.wave.Lib -> a.a:",
    "    void load() -> a",
    "dev.leoperez.wave.MainActivity -> dev.leoperez.wave.MainActivity:",
    "com.facebook.react.Bridge -> com.facebook.react.Bridge:",
  );
  const apk = {
    metadata: true,
    rules: parseProfileText(
      text(
        "La/a;",
        "Ldev/leoperez/wave/MainActivity;",
        "HSPLandroidx/core/A;->b()V",
        "Landroidx/core/A;",
      ),
    ).rules,
    dexClasses: new Map([
      ["classes.dex", ["La/a;", "Ldev/leoperez/wave/MainActivity;", "Landroidx/core/A;"]],
      ["classes2.dex", ["Lcom/facebook/react/Bridge;"]],
    ]),
  };
  const baseline = parseProfileText(
    text(
      "Ldev/leoperez/wave/Lib;",
      "Ldev/leoperez/wave/MainActivity;",
      "Ldev/leoperez/wave/Gone;",
      "Lcom/facebook/react/Bridge;",
    ),
  ).rules;

  it("counts the shipped rules by library, with the names R8 changed restored", () => {
    const report = checkApkProfile(apk, { mapping });
    assert.equal(report.packaged, true);
    assert.deepEqual(report.classes, 3);
    assert.deepEqual(report.methods, { total: 1, hot: 1, startup: 1, postStartup: 1 });
    assert.deepEqual(report.classesByGroup, { wave: 2, androidx: 1 });
  });

  it("says how much of Wave's own profile the APK ships, leaving out what R8 removed", () => {
    const report = checkApkProfile(apk, { mapping, baseline });
    // Lib and MainActivity are in the profile, Bridge isn't, Gone isn't in the APK.
    assert.deepEqual(report.baseline, {
      expected: 3,
      shipped: 2,
      missing: ["Lcom/facebook/react/Bridge;"],
    });
  });

  it("says where the startup profile's classes landed: the first dex is loaded first", () => {
    const startup = parseProfileText(
      text("Ldev/leoperez/wave/Lib;", "Lcom/facebook/react/Bridge;"),
    ).rules;
    const report = checkApkProfile(apk, { mapping, startup });
    assert.deepEqual(report.startup, { expected: 2, inPrimaryDex: 1 });
  });

  it("reports an APK without a profile", () => {
    const report = checkApkProfile({ ...apk, rules: null, metadata: false }, { baseline });
    assert.equal(report.packaged, false);
    assert.equal(report.classes, 0);
    assert.deepEqual(report.baseline, {
      expected: 2,
      shipped: 0,
      missing: ["Lcom/facebook/react/Bridge;", "Ldev/leoperez/wave/MainActivity;"],
    });
  });
});

/** An APK without a profile whose classes.dex has [classes]. */
const apkWith = (classes: string[]) => ({
  rules: null,
  metadata: false,
  dexClasses: new Map([["classes.dex", classes]]),
});

describe("looksMinified", () => {
  // A Wave release APK from R8: 7,108 of its 11,190 types are in the default package (a00…).
  it("spots R8's renamed classes, which a profile can't be captured from", () => {
    assert.equal(
      looksMinified(apkWith(["La00;", "La01;", "Lq00;", "Ldev/leoperez/wave/MainActivity;"])),
      true,
    );
  });

  it("passes an APK whose classes keep their names", () => {
    assert.equal(
      looksMinified(
        apkWith([
          "Ldev/leoperez/wave/MainActivity;",
          "Landroidx/core/A;",
          "Lcom/facebook/react/B;",
        ]),
      ),
      false,
    );
  });
});

describe("mergeProfiles", () => {
  it("keeps every class and method, with the flags from each", () => {
    const merged = mergeProfiles(
      parseProfileText(text("SLa/B;->c()V", "La/B;")).rules,
      parseProfileText(text("HLa/B;->c()V", "PLa/C;->d()V", "La/C;")).rules,
    );
    assert.equal(formatProfile(merged), text("HSLa/B;->c()V", "PLa/C;->d()V", "La/B;", "La/C;"));
  });
});
