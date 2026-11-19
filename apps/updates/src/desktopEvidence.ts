import { createHash, createPublicKey, type KeyObject } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  artifactName,
  desktopPlatforms,
  desktopVersion,
  type DesktopPlatform,
} from "./desktopProtocol.ts";
import { desktopFileDigest } from "./desktopSignature.ts";

type FileEvidence = { readonly name: string; readonly sha512: string; readonly size: number };
export type DesktopEvidence = {
  readonly source: string;
  readonly tag: string;
  readonly publicKeySha256: string;
  readonly files: Readonly<Record<DesktopPlatform, readonly FileEvidence[]>>;
};

export const desktopArtifact = (platform: DesktopPlatform) => `desktop-release-${platform}`;

export const desktopKeyDigest = (key: string | KeyObject): string => {
  const publicKey = typeof key === "string" || key.type === "private" ? createPublicKey(key) : key;
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Expected an Ed25519 public key");
  return createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
};

const filesFor = (platform: DesktopPlatform, tag: string): string[] => {
  const version = tag.slice(1);
  if (!tag.startsWith("v") || !desktopVersion(version, tag.endsWith("-ti") ? "ti" : "main")) {
    throw new Error("Invalid desktop release tag");
  }
  const installer = artifactName(platform, version);
  return platform === "win32" ? [installer, `${installer}.blockmap`] : [installer];
};

const evidenceOf = async (dir: string, name: string): Promise<FileEvidence> => {
  const path = join(dir, name);
  const info = await stat(path);
  if (!info.isFile() || info.size === 0) throw new Error(`Missing desktop artifact ${name}`);
  return { name, size: info.size, sha512: await desktopFileDigest(path) };
};

export const recordDesktopBuild = async (
  dir: string,
  platform: DesktopPlatform,
  source: string,
  tag: string,
  publicKeySha256: string,
) => {
  const files = await Promise.all(filesFor(platform, tag).map((name) => evidenceOf(dir, name)));
  await writeFile(
    join(dir, "build.json"),
    JSON.stringify({ source, tag, platform, publicKeySha256, files }),
  );
};

const checkFiles = async (
  dir: string,
  platform: DesktopPlatform,
  tag: string,
  files: readonly FileEvidence[],
) => {
  const names = filesFor(platform, tag);
  if (!Array.isArray(files) || files.length !== names.length)
    throw new Error(`Incomplete desktop evidence for ${platform}`);
  for (const [index, name] of names.entries()) {
    const expected = files[index];
    const actual = await evidenceOf(dir, name);
    if (
      expected?.name !== actual.name ||
      expected.sha512 !== actual.sha512 ||
      expected.size !== actual.size
    ) {
      throw new Error(`Desktop artifact ${name} does not match release evidence`);
    }
  }
};

export const admitDesktop = async (
  root: string,
  source: string,
  tag: string,
): Promise<DesktopEvidence> => {
  const readBuild = async (platform: DesktopPlatform) => {
    const dir = join(root, desktopArtifact(platform));
    const build = JSON.parse(await readFile(join(dir, "build.json"), "utf8"));
    if (
      build.source !== source ||
      build.tag !== tag ||
      build.platform !== platform ||
      !/^[0-9a-f]{64}$/.test(build.publicKeySha256)
    ) {
      throw new Error(`Desktop ${platform} build did not report the release source, tag or key`);
    }
    await checkFiles(dir, platform, tag, build.files);
    return build as Pick<DesktopEvidence, "publicKeySha256"> & { files: readonly FileEvidence[] };
  };
  const [win32, linux] = await Promise.all([readBuild("win32"), readBuild("linux")]);
  if (win32.publicKeySha256 !== linux.publicKeySha256)
    throw new Error("Desktop builds have different update keys");
  return {
    source,
    tag,
    publicKeySha256: win32.publicKeySha256,
    files: { win32: win32.files, linux: linux.files },
  };
};

export const verifyDesktopFiles = async (root: string, proof: DesktopEvidence, flat = false) => {
  await Promise.all(
    desktopPlatforms.map((platform) =>
      checkFiles(
        flat ? root : join(root, desktopArtifact(platform)),
        platform,
        proof.tag,
        proof.files[platform],
      ),
    ),
  );
};
