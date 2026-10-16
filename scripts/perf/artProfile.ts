// ART profiles (#317): what an APK ships in `assets/dexopt/baseline.prof`, and the
// human-readable profiles `perf.ts profile generate` captures on the phone. No dependencies:
// the APK is read with node:zlib, its dex files with a few header fields.
import { crc32, inflateRawSync, inflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// The binary profile AGP packages (profgen's V0_1_0_P format, as androidx.profileinstaller
// reads it): "pro\0", "010\0", a dex count, then one zlib stream holding a header per dex
// and, per dex, its hot methods, its classes and a startup/post-startup bitmap.

export interface DexProfile {
  /** The dex the rules are for, e.g. `classes.dex` or `classes2.dex`. */
  readonly key: string;
  readonly checksum: number;
  readonly methodCount: number;
  /** Type indexes of the classes the profile lists. */
  readonly classes: readonly number[];
  /** Method indexes, by flag. */
  readonly hot: readonly number[];
  readonly startup: readonly number[];
  readonly postStartup: readonly number[];
}

export interface BinaryProfile {
  readonly version: string;
  readonly dexes: readonly DexProfile[];
}

class Reader {
  offset = 0;
  readonly buffer: Buffer;
  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }
  u8(): number {
    return this.buffer.readUInt8(this.take(1));
  }
  u16(): number {
    return this.buffer.readUInt16LE(this.take(2));
  }
  u32(): number {
    return this.buffer.readUInt32LE(this.take(4));
  }
  bytes(length: number): Buffer {
    const start = this.take(length);
    return this.buffer.subarray(start, start + length);
  }
  private take(length: number): number {
    const start = this.offset;
    if (start + length > this.buffer.length) throw new Error("The ART profile is truncated.");
    this.offset += length;
    return start;
  }
}

const MAGIC = "pro\0";

export const decodeBinaryProfile = (file: Buffer): BinaryProfile => {
  if (file.length < 8 || file.toString("latin1", 0, 4) !== MAGIC)
    throw new Error("Not an ART profile (no pro\\0 magic).");
  const version = file.toString("latin1", 4, 7);
  if (version !== "010")
    throw new Error(`ART profile version ${version} isn't supported (AGP writes 010).`);
  const outer = new Reader(file);
  outer.offset = 8;
  const dexCount = outer.u8();
  const uncompressedSize = outer.u32();
  const compressedSize = outer.u32();
  const body = inflateSync(outer.bytes(compressedSize));
  if (body.length !== uncompressedSize)
    throw new Error(`The ART profile's body is ${body.length} bytes, not ${uncompressedSize}.`);
  const reader = new Reader(body);
  const headers = Array.from({ length: dexCount }, () => {
    const keySize = reader.u16();
    const classCount = reader.u16();
    const hotRegionSize = reader.u32();
    const checksum = reader.u32();
    const methodCount = reader.u32();
    const key = reader.bytes(keySize).toString("utf8");
    return { key, classCount, hotRegionSize, checksum, methodCount };
  });
  const dexes = headers.map((header): DexProfile => {
    // Hot methods: a delta-encoded method index and an inline cache count (always 0 here).
    const hot: number[] = [];
    const hotEnd = reader.offset + header.hotRegionSize;
    let method = 0;
    while (reader.offset < hotEnd) {
      method += reader.u16();
      const inlineCaches = reader.u16();
      if (inlineCaches !== 0) throw new Error("ART profiles with inline caches aren't supported.");
      hot.push(method);
    }
    const classes: number[] = [];
    let type = 0;
    for (let i = 0; i < header.classCount; i++) {
      type += reader.u16();
      classes.push(type);
    }
    // Two bits per method, lowest bit first: startup for index i, post-startup at count + i.
    const bitmap = reader.bytes(Math.ceil((header.methodCount * 2) / 8));
    const flagged = (bit: number): boolean => ((bitmap[bit >> 3] ?? 0) & (1 << (bit & 7))) !== 0;
    const startup: number[] = [];
    const postStartup: number[] = [];
    for (let i = 0; i < header.methodCount; i++) {
      if (flagged(i)) startup.push(i);
      if (flagged(header.methodCount + i)) postStartup.push(i);
    }
    return {
      key: header.key,
      checksum: header.checksum,
      methodCount: header.methodCount,
      classes,
      hot,
      startup,
      postStartup,
    };
  });
  return { version, dexes };
};

// ---------------------------------------------------------------------------
// Rules, the human-readable form (HRF) AGP, profman and R8 read: `Lpkg/Class;` for a class,
// `HSPLpkg/Class;->method(Args)Ret` for a method with its flags (Hot, Startup, Post-startup).

export interface ProfileRules {
  /** Class descriptors, `Lpkg/Class;`. */
  readonly classes: ReadonlySet<string>;
  /** Method descriptors, `Lpkg/Class;->name(Args)Ret`, with their flags in `HSP` order. */
  readonly methods: ReadonlyMap<string, string>;
}

const FLAG_ORDER = "HSP";

const normalizeFlags = (flags: string): string =>
  [...FLAG_ORDER].filter((flag) => flags.includes(flag)).join("");

const CLASS_RULE = /^L[^;\s]+;$/;
const METHOD_RULE = /^([HSP]*)(L[^;\s]+;->[^(\s]+\([^)\s]*\)\S+)$/;

/**
 * A profile file's rules. `invalid` lists the lines that are neither a rule, a comment
 * (`#`) nor blank. Rules with wildcards (`**`) don't parse: Wave's profiles are captured,
 * not written by hand.
 */
export const parseProfileText = (
  text: string,
): { rules: ProfileRules; invalid: readonly string[] } => {
  const classes = new Set<string>();
  const methods = new Map<string, string>();
  const invalid: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const method = METHOD_RULE.exec(line);
    if (method !== null) {
      const [, flags = "", descriptor = ""] = method;
      methods.set(descriptor, normalizeFlags((methods.get(descriptor) ?? "") + flags));
    } else if (CLASS_RULE.test(line)) classes.add(line);
    else invalid.push(line);
  }
  return { rules: { classes, methods }, invalid };
};

/** Every class and method of [profiles], each method with the flags any of them gives it. */
export const mergeProfiles = (...profiles: readonly ProfileRules[]): ProfileRules => {
  const classes = new Set<string>();
  const methods = new Map<string, string>();
  for (const profile of profiles) {
    for (const type of profile.classes) classes.add(type);
    for (const [method, flags] of profile.methods)
      methods.set(method, normalizeFlags((methods.get(method) ?? "") + flags));
  }
  return { classes, methods };
};

/** One file's rules, sorted: methods, then classes. */
export const formatProfile = (rules: ProfileRules): string => {
  const methods = [...rules.methods]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([method, flags]) => `${flags}${method}`);
  const classes = [...rules.classes].toSorted();
  return [...methods, ...classes].map((line) => `${line}\n`).join("");
};

// ---------------------------------------------------------------------------
// The APK: a zip whose entries we read through its central directory.

const readZip = (zip: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> => {
  const minEnd = Math.max(0, zip.length - 22 - 0xffff);
  let end = -1;
  for (let at = zip.length - 22; at >= minEnd; at--)
    if (zip.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  if (end === -1) throw new Error("Not a zip file (no end of central directory).");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("The zip's directory is corrupt.");
    const method = zip.readUInt16LE(at + 10);
    const compressedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compressedSize);
    if (method === 0) entries.set(name, raw);
    else if (method === 8) entries.set(name, inflateRawSync(raw));
    else throw new Error(`${name} uses zip method ${method}, which isn't supported.`);
  }
  return entries;
};

// ---------------------------------------------------------------------------
// Dex files: just enough to name a type or a method by its index.

interface Dex {
  /** What ART and profiles key a dex in an APK by: its CRC-32, not the header's Adler-32. */
  readonly checksum: number;
  readonly type: (index: number) => string;
  readonly method: (index: number) => string;
  readonly typeCount: number;
}

const readUleb = (buffer: Buffer, at: number): { value: number; next: number } => {
  let value = 0;
  let shift = 0;
  let byte: number;
  do {
    byte = buffer.readUInt8(at++);
    value |= (byte & 0x7f) << shift;
    shift += 7;
  } while ((byte & 0x80) !== 0);
  return { value: value >>> 0, next: at };
};

const parseDex = (dex: Buffer): Dex => {
  if (dex.toString("latin1", 0, 4) !== "dex\n") throw new Error("Not a dex file.");
  const stringIds = dex.readUInt32LE(0x3c);
  const typeIds = dex.readUInt32LE(0x44);
  const protoIds = dex.readUInt32LE(0x4c);
  const methodIds = dex.readUInt32LE(0x5c);
  const string = (index: number): string => {
    const data = dex.readUInt32LE(stringIds + index * 4);
    const { next } = readUleb(dex, data);
    const end = dex.indexOf(0, next);
    // MUTF-8; identical to UTF-8 for the names a profile holds.
    return dex.toString("utf8", next, end);
  };
  const type = (index: number): string => string(dex.readUInt32LE(typeIds + index * 4));
  const method = (index: number): string => {
    const at = methodIds + index * 8;
    const owner = type(dex.readUInt16LE(at));
    const proto = protoIds + dex.readUInt16LE(at + 2) * 12;
    const name = string(dex.readUInt32LE(at + 4));
    const returns = type(dex.readUInt32LE(proto + 4));
    const parametersAt = dex.readUInt32LE(proto + 8);
    const parameters =
      parametersAt === 0
        ? []
        : Array.from({ length: dex.readUInt32LE(parametersAt) }, (_, i) =>
            type(dex.readUInt16LE(parametersAt + 4 + i * 2)),
          );
    return `${owner}->${name}(${parameters.join("")})${returns}`;
  };
  return { checksum: crc32(dex), type, method, typeCount: dex.readUInt32LE(0x40) };
};

/** `classes.dex` for a profile key such as `classes.dex`, `base.apk!classes2.dex` or ``. */
const dexName = (key: string): string => /classes\d*\.dex$/.exec(key)?.[0] ?? "classes.dex";

export interface ApkProfile {
  /** The rules in `assets/dexopt/baseline.prof`, named from the APK's dex files; null if none. */
  readonly rules: ProfileRules | null;
  /** Whether `assets/dexopt/baseline.profm`, which Android 12+ needs to install it, is there. */
  readonly metadata: boolean;
  /** Each dex file's class descriptors, by file name. */
  readonly dexClasses: ReadonlyMap<string, readonly string[]>;
}

const PROFILE = "assets/dexopt/baseline.prof";
const METADATA = "assets/dexopt/baseline.profm";

export const readApkProfile = (apk: Buffer): ApkProfile => {
  const entries = readZip(
    apk,
    (name) => name === PROFILE || name === METADATA || /^classes\d*\.dex$/.test(name),
  );
  const dexes = new Map<string, Dex>();
  for (const [name, content] of entries)
    if (name.endsWith(".dex")) dexes.set(name, parseDex(content));
  const dexClasses = new Map(
    [...dexes].map(([name, dex]) => [
      name,
      Array.from({ length: dex.typeCount }, (_, i) => dex.type(i)).filter((type) =>
        type.startsWith("L"),
      ),
    ]),
  );
  const binary = entries.get(PROFILE);
  if (binary === undefined) return { rules: null, metadata: entries.has(METADATA), dexClasses };
  const classes = new Set<string>();
  const methods = new Map<string, string>();
  for (const profile of decodeBinaryProfile(binary).dexes) {
    const name = dexName(profile.key);
    const dex = dexes.get(name);
    if (dex === undefined) throw new Error(`The profile lists ${name}, which the APK hasn't got.`);
    if (dex.checksum !== profile.checksum)
      throw new Error(`The profile was made for another ${name} (checksum differs).`);
    for (const type of profile.classes) classes.add(dex.type(type));
    const flags = new Map<number, string>();
    const flag = (indexes: readonly number[], letter: string): void => {
      for (const index of indexes) flags.set(index, (flags.get(index) ?? "") + letter);
    };
    flag(profile.hot, "H");
    flag(profile.startup, "S");
    flag(profile.postStartup, "P");
    for (const [index, letters] of flags) methods.set(dex.method(index), normalizeFlags(letters));
  }
  return { rules: { classes, methods }, metadata: entries.has(METADATA), dexClasses };
};

/**
 * Whether R8 renamed the APK's classes. R8 moves the classes it renames into the default
 * package (`La00;`); an APK built without it has next to none there. A profile captured from
 * renamed classes wouldn't match the next build's names, so capturing needs an APK built with
 * `-Pandroid.enableMinifyInReleaseBuilds=false`.
 */
export const looksMinified = (apk: ApkProfile): boolean => {
  const classes = [...apk.dexClasses.values()].flat();
  const unpackaged = classes.filter((type) => !type.includes("/")).length;
  return classes.length > 0 && unpackaged / classes.length > 0.1;
};

// ---------------------------------------------------------------------------
// Checking what an APK ships against Wave's own profiles.

/** Where a class comes from, for counting a profile's rules. First match wins. */
const GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ["wave", ["Ldev/leoperez/wave/", "Lexpo/modules/wavenative/", "Lexpo/modules/waveglass/"]],
  ["react", ["Lcom/facebook/"]],
  ["expo", ["Lexpo/"]],
  ["media3", ["Landroidx/media3/"]],
  ["androidx", ["Landroidx/"]],
  ["kotlin", ["Lkotlin/", "Lkotlinx/"]],
];

const groupOf = (type: string): string =>
  GROUPS.find(([, prefixes]) => prefixes.some((prefix) => type.startsWith(prefix)))?.[0] ?? "other";

const descriptor = (javaName: string): string => `L${javaName.replace(/\./g, "/")};`;

/** R8's class renames from mapping.txt: original to shipped, and back. */
const readMapping = (
  mapping: string | undefined,
): { toShipped: (type: string) => string; toOriginal: (type: string) => string } => {
  const forward = new Map<string, string>();
  const back = new Map<string, string>();
  for (const match of (mapping ?? "").matchAll(/^(\S+) -> (\S+):$/gm)) {
    const original = descriptor(match[1] ?? "");
    const shipped = descriptor(match[2] ?? "");
    forward.set(original, shipped);
    back.set(shipped, original);
  }
  return {
    toShipped: (type) => forward.get(type) ?? type,
    toOriginal: (type) => back.get(type) ?? type,
  };
};

/** The classes a profile names: its class rules and the owners of its method rules. */
const classesOf = (rules: ProfileRules): Set<string> =>
  new Set([
    ...rules.classes,
    ...[...rules.methods.keys()].map((method) => method.slice(0, method.indexOf("->"))),
  ]);

export interface ApkProfileReport {
  /** `assets/dexopt/baseline.prof` is in the APK. */
  readonly packaged: boolean;
  /** `assets/dexopt/baseline.profm` is in the APK. */
  readonly metadata: boolean;
  readonly classes: number;
  readonly methods: {
    readonly total: number;
    readonly hot: number;
    readonly startup: number;
    readonly postStartup: number;
  };
  /** Class rules by where the class comes from (`wave`, `react`, `expo`, `media3`…). */
  readonly classesByGroup: Readonly<Record<string, number>>;
  /**
   * Classes Wave's baseline profile names that are in the APK (`expected`), how many of them
   * the APK's profile lists (`shipped`), and the rest. Classes R8 removed don't count.
   */
  readonly baseline: {
    readonly expected: number;
    readonly shipped: number;
    readonly missing: readonly string[];
  } | null;
  /** Classes Wave's startup profile names that are in the APK, and how many are in classes.dex. */
  readonly startup: { readonly expected: number; readonly inPrimaryDex: number } | null;
}

export const checkApkProfile = (
  apk: ApkProfile,
  options: { mapping?: string; baseline?: ProfileRules; startup?: ProfileRules },
): ApkProfileReport => {
  const { toShipped, toOriginal } = readMapping(options.mapping);
  const inApk = new Set([...apk.dexClasses.values()].flat());
  const primary = new Set(apk.dexClasses.get("classes.dex") ?? []);
  const rules = apk.rules ?? { classes: new Set<string>(), methods: new Map<string, string>() };
  const flags = [...rules.methods.values()];
  const classesByGroup: Record<string, number> = {};
  for (const type of rules.classes) {
    const group = groupOf(toOriginal(type));
    classesByGroup[group] = (classesByGroup[group] ?? 0) + 1;
  }
  /** The profile's classes R8 kept, by original and shipped name. */
  const present = (profile: ProfileRules): { original: string; shipped: string }[] =>
    [...classesOf(profile)]
      .map((original) => ({ original, shipped: toShipped(original) }))
      .filter(({ shipped }) => inApk.has(shipped));
  const expectedBaseline = options.baseline === undefined ? null : present(options.baseline);
  const missing = (expectedBaseline ?? [])
    .filter(({ shipped }) => !rules.classes.has(shipped))
    .map(({ original }) => original)
    .toSorted();
  const expectedStartup = options.startup === undefined ? null : present(options.startup);
  return {
    packaged: apk.rules !== null,
    metadata: apk.metadata,
    classes: rules.classes.size,
    methods: {
      total: flags.length,
      hot: flags.filter((f) => f.includes("H")).length,
      startup: flags.filter((f) => f.includes("S")).length,
      postStartup: flags.filter((f) => f.includes("P")).length,
    },
    classesByGroup,
    baseline:
      expectedBaseline === null
        ? null
        : {
            expected: expectedBaseline.length,
            shipped: expectedBaseline.length - missing.length,
            missing,
          },
    startup:
      expectedStartup === null
        ? null
        : {
            expected: expectedStartup.length,
            inPrimaryDex: expectedStartup.filter(({ shipped }) => primary.has(shipped)).length,
          },
  };
};
