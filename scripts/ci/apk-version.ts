// A repacked APK carries this run's app version, not its kept build's (docs/spec.md, Test
// branch and prereleases): repack.sh unpacks the two files that hold it and this rewrites them.
//   node scripts/ci/apk-version.ts <app/build.gradle> <dir>
// <dir> holds the kept APK's AndroidManifest.xml (compiled) and assets/app.config (Expo's
// embedded app config, which expo-constants reads). Both are set to the versionCode and
// versionName prebuild wrote into the generated app/build.gradle, as a full build would.
// Prints them as aapt2's badging shows them (`versionCode='504' versionName='0.5.4-ti'`), so
// repack.sh can check the signed APK, and what changed on stderr.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Android's version of an APK. */
export type ApkVersion = { versionCode: number; versionName: string };

// Android's binary XML (frameworks/base/libs/androidfw/include/androidfw/ResourceTypes.h).
const XML = 0x0003;
const STRING_POOL = 0x0001;
const RESOURCE_MAP = 0x0180;
const START_ELEMENT = 0x0102;
const UTF8_FLAG = 0x100;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
// android:versionCode and android:versionName, by resource id as Android looks them up.
const VERSION_CODE = 0x0101021b;
const VERSION_NAME = 0x0101021c;
const SORTED_FLAG = 0x1;

type Chunk = { type: number; headerSize: number; offset: number; size: number };

const chunkAt = (xml: Buffer, offset: number): Chunk => {
  if (offset + 8 > xml.length) throw new Error(`Truncated chunk at byte ${offset}.`);
  const chunk = {
    type: xml.readUInt16LE(offset),
    headerSize: xml.readUInt16LE(offset + 2),
    offset,
    size: xml.readUInt32LE(offset + 4),
  };
  if (chunk.size < 8 || offset + chunk.size > xml.length)
    throw new Error(`Chunk 0x${chunk.type.toString(16)} at byte ${offset} overruns the file.`);
  return chunk;
};

// The string pool's layout and its strings (UTF-16 only: aapt2 writes manifests in UTF-16).
type StringPool = Chunk & {
  count: number;
  styleCount: number;
  flags: number;
  stringsStart: number;
  stylesStart: number;
  strings: string[];
};

const readStringPool = (xml: Buffer, chunk: Chunk): StringPool => {
  const at = chunk.offset;
  const count = xml.readUInt32LE(at + 8);
  const styleCount = xml.readUInt32LE(at + 12);
  const flags = xml.readUInt32LE(at + 16);
  const stringsStart = xml.readUInt32LE(at + 20);
  const stylesStart = xml.readUInt32LE(at + 24);
  if (flags & UTF8_FLAG)
    throw new Error("The manifest's string pool is UTF-8; only UTF-16 is supported.");
  const strings = Array.from({ length: count }, (_, index) => {
    let position = at + stringsStart + xml.readUInt32LE(at + chunk.headerSize + index * 4);
    let length = xml.readUInt16LE(position);
    position += 2;
    if (length & 0x8000) {
      length = ((length & 0x7fff) << 16) | xml.readUInt16LE(position);
      position += 2;
    }
    return xml.toString("utf16le", position, position + length * 2);
  });
  return { ...chunk, count, styleCount, flags, stringsStart, stylesStart, strings };
};

// A UTF-16 pool string: its length in code units (two u16 when it's long), the units, a 0.
const utf16 = (text: string): Buffer => {
  const units = Buffer.from(text, "utf16le");
  const length = units.length / 2;
  const prefix =
    length > 0x7fff
      ? Buffer.from([
          (length >> 16) & 0xff,
          0x80 | (length >> 24),
          length & 0xff,
          (length >> 8) & 0xff,
        ])
      : Buffer.from([length & 0xff, length >> 8]);
  return Buffer.concat([prefix, units, Buffer.alloc(2)]);
};

// The pool with `text` appended as its last string, so whatever else used the old version's
// string keeps it. Styles only cover the first strings, and the resource map only attribute
// names, so neither moves. An appended string breaks a sorted pool's order: the flag goes.
const withString = (xml: Buffer, pool: StringPool, text: string): Buffer => {
  const at = pool.offset;
  const offsets = xml.subarray(at + pool.headerSize, at + pool.headerSize + pool.count * 4);
  const styleOffsets = xml.subarray(
    at + pool.headerSize + pool.count * 4,
    at + pool.headerSize + (pool.count + pool.styleCount) * 4,
  );
  const stringsEnd = pool.styleCount > 0 ? pool.stylesStart : pool.size;
  const oldStrings = xml.subarray(at + pool.stringsStart, at + stringsEnd);
  const added = Buffer.alloc(4);
  added.writeUInt32LE(oldStrings.length);
  const encoded = utf16(text);
  const strings = Buffer.concat([
    oldStrings,
    encoded,
    Buffer.alloc((4 - ((oldStrings.length + encoded.length) % 4)) % 4),
  ]);
  const styles =
    pool.styleCount > 0 ? xml.subarray(at + pool.stylesStart, at + pool.size) : Buffer.alloc(0);
  const header = Buffer.from(xml.subarray(at, at + pool.headerSize));
  const stringsStart = pool.headerSize + (pool.count + 1 + pool.styleCount) * 4;
  header.writeUInt32LE(stringsStart + strings.length + styles.length, 4);
  header.writeUInt32LE(pool.count + 1, 8);
  header.writeUInt32LE(pool.flags & ~SORTED_FLAG, 16);
  header.writeUInt32LE(stringsStart, 20);
  header.writeUInt32LE(pool.styleCount > 0 ? stringsStart + strings.length : 0, 24);
  return Buffer.concat([header, offsets, added, styleOffsets, strings, styles]);
};

// A compiled XML file's elements in order: the name, the attribute offsets, and what those index.
type Element = { name: string; pool: StringPool; resourceIds: number[]; attributes: number[] };

function* readElements(xml: Buffer): Generator<Element> {
  const file = chunkAt(xml, 0);
  if (file.type !== XML) throw new Error("This isn't a compiled Android XML file.");
  let pool: StringPool | undefined;
  let resourceIds: number[] = [];
  let offset = file.headerSize;
  while (offset < file.size) {
    const chunk = chunkAt(xml, offset);
    offset += chunk.size;
    if (chunk.type === STRING_POOL) pool = readStringPool(xml, chunk);
    else if (chunk.type === RESOURCE_MAP)
      resourceIds = Array.from({ length: (chunk.size - chunk.headerSize) / 4 }, (_, index) =>
        xml.readUInt32LE(chunk.offset + chunk.headerSize + index * 4),
      );
    else if (chunk.type === START_ELEMENT) {
      if (!pool) throw new Error("The manifest has no string pool before its first element.");
      const ext = chunk.offset + chunk.headerSize;
      const attributeStart = xml.readUInt16LE(ext + 8);
      const attributeSize = xml.readUInt16LE(ext + 10);
      const attributes = Array.from(
        { length: xml.readUInt16LE(ext + 12) },
        (_, index) => ext + attributeStart + index * attributeSize,
      );
      yield { name: pool.strings[xml.readUInt32LE(ext + 4)] ?? "", pool, resourceIds, attributes };
    }
  }
}

// Where the <manifest> element's version attributes are, and the strings they index.
type Manifest = { pool: StringPool; versionCode: number; versionName: number };

const readManifest = (xml: Buffer): Manifest => {
  for (const { name, pool, resourceIds, attributes } of readElements(xml)) {
    if (name !== "manifest") throw new Error(`The root element is <${name}>, not <manifest>.`);
    const find = (id: number, label: string) => {
      const attribute = attributes.find((at) => resourceIds[xml.readUInt32LE(at + 4)] === id);
      if (attribute === undefined) throw new Error(`<manifest> has no android:${label}.`);
      return attribute;
    };
    return {
      pool,
      versionCode: find(VERSION_CODE, "versionCode"),
      versionName: find(VERSION_NAME, "versionName"),
    };
  }
  throw new Error("The manifest has no <manifest> element.");
};

/** The versionCode and versionName of a compiled AndroidManifest.xml. */
export const manifestVersion = (xml: Buffer): ApkVersion => {
  const manifest = readManifest(xml);
  const codeType = xml.readUInt8(manifest.versionCode + 15);
  if (codeType !== TYPE_INT_DEC && codeType !== TYPE_INT_HEX)
    throw new Error("android:versionCode isn't an integer.");
  if (xml.readUInt8(manifest.versionName + 15) !== TYPE_STRING)
    throw new Error("android:versionName isn't a string.");
  const versionName = manifest.pool.strings[xml.readUInt32LE(manifest.versionName + 16)];
  if (versionName === undefined) throw new Error("android:versionName's string is missing.");
  return { versionCode: xml.readUInt32LE(manifest.versionCode + 16), versionName };
};

/**
 * A copy of a compiled AndroidManifest.xml with `version` as its versionCode and versionName.
 * The name is a new string at the end of the string pool, which moves the chunks after it.
 */
export const withManifestVersion = (xml: Buffer, version: ApkVersion): Buffer => {
  manifestVersion(xml);
  const { pool, versionCode, versionName } = readManifest(xml);
  const newPool = withString(xml, pool, version.versionName);
  const shift = newPool.length - pool.size;
  const patched = Buffer.concat([
    xml.subarray(0, pool.offset),
    newPool,
    xml.subarray(pool.offset + pool.size),
  ]);
  patched.writeUInt32LE(patched.length, 4);
  patched.writeUInt8(TYPE_INT_DEC, versionCode + shift + 15);
  patched.writeUInt32LE(version.versionCode, versionCode + shift + 16);
  // Its raw value and its typed value both index the string.
  patched.writeUInt32LE(pool.count, versionName + shift + 8);
  patched.writeUInt32LE(pool.count, versionName + shift + 16);
  return patched;
};

// android:name and android:value, by resource id.
const ATTR_NAME = 0x01010003;
const ATTR_VALUE = 0x01010024;
const TYPE_BOOLEAN = 0x12;

// The string pool, and the android:value attribute of the <meta-data> called `name`.
const findMetaData = (xml: Buffer, name: string): { pool: StringPool; value: number } => {
  for (const element of readElements(xml)) {
    if (element.name !== "meta-data") continue;
    const { pool, resourceIds, attributes } = element;
    const attribute = (id: number) =>
      attributes.find((at) => resourceIds[xml.readUInt32LE(at + 4)] === id);
    const nameAttribute = attribute(ATTR_NAME);
    const value = attribute(ATTR_VALUE);
    if (nameAttribute === undefined || value === undefined) continue;
    if (pool.strings[xml.readUInt32LE(nameAttribute + 16)] === name) return { pool, value };
  }
  throw new Error(`The manifest has no <meta-data> called ${name}.`);
};

/** A <meta-data> value of a compiled AndroidManifest.xml, when it's a string or a boolean. */
export const manifestMetaData = (xml: Buffer, name: string): string | boolean => {
  const { pool, value } = findMetaData(xml, name);
  const type = xml.readUInt8(value + 15);
  const data = xml.readUInt32LE(value + 16);
  if (type === TYPE_BOOLEAN) return data !== 0;
  const text = type === TYPE_STRING ? pool.strings[data] : undefined;
  if (text === undefined) throw new Error(`${name} isn't a string or a boolean.`);
  return text;
};

const NO_STRING = 0xffffffff;

/**
 * A copy of a compiled AndroidManifest.xml with these <meta-data> values, whatever type each
 * had (prebuild's runtime version is a reference to a string resource). A name it doesn't have
 * throws: a kept build without it isn't one this run can configure.
 */
export const withManifestMetaData = (
  xml: Buffer,
  values: Record<string, string | boolean>,
): Buffer =>
  Object.entries(values).reduce((current, [name, value]) => {
    const { pool, value: attribute } = findMetaData(current, name);
    if (typeof value === "boolean") {
      const patched = Buffer.from(current);
      patched.writeUInt32LE(NO_STRING, attribute + 8);
      patched.writeUInt8(TYPE_BOOLEAN, attribute + 15);
      patched.writeUInt32LE(value ? 0xffffffff : 0, attribute + 16);
      return patched;
    }
    const newPool = withString(current, pool, value);
    const shift = newPool.length - pool.size;
    const patched = Buffer.concat([
      current.subarray(0, pool.offset),
      newPool,
      current.subarray(pool.offset + pool.size),
    ]);
    patched.writeUInt32LE(patched.length, 4);
    patched.writeUInt32LE(pool.count, attribute + shift + 8);
    patched.writeUInt8(TYPE_STRING, attribute + shift + 15);
    patched.writeUInt32LE(pool.count, attribute + shift + 16);
    return patched;
  }, xml);

/** The version prebuild wrote into the generated app/build.gradle's defaultConfig. */
export const gradleVersion = (buildGradle: string): ApkVersion => {
  const code = /^\s*versionCode\s+(\d+)\s*$/m.exec(buildGradle)?.[1];
  const name = /^\s*versionName\s+["']([^"']+)["']\s*$/m.exec(buildGradle)?.[1];
  if (code === undefined || name === undefined)
    throw new Error("app/build.gradle sets no versionCode and versionName.");
  return { versionCode: Number(code), versionName: name };
};

/** Expo's embedded app config (assets/app.config) with `version` as its app version. */
export const withAppConfigVersion = (appConfig: string, version: ApkVersion): string => {
  const config = JSON.parse(appConfig);
  config.version = version.versionName;
  config.android = { ...config.android, versionCode: version.versionCode };
  return JSON.stringify(config);
};

const cli = ([buildGradle = "", dir = ""]: string[]) => {
  const version = gradleVersion(readFileSync(buildGradle, "utf8"));
  const manifestPath = join(dir, "AndroidManifest.xml");
  const manifest = readFileSync(manifestPath);
  const kept = manifestVersion(manifest);
  writeFileSync(manifestPath, withManifestVersion(manifest, version));
  const configPath = join(dir, "assets/app.config");
  writeFileSync(configPath, withAppConfigVersion(readFileSync(configPath, "utf8"), version));
  console.error(
    `The kept build is ${kept.versionName} (${kept.versionCode}); the repacked APK is ` +
      `${version.versionName} (${version.versionCode}).`,
  );
  console.log(`versionCode='${version.versionCode}' versionName='${version.versionName}'`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) cli(process.argv.slice(2));
