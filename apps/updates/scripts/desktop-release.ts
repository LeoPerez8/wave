import { createPrivateKey } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { desktopPlatforms } from "../src/desktopProtocol.ts";
import {
  admitDesktop,
  desktopArtifact,
  desktopReleaseFiles,
  finalizeWindowsDesktop,
  verifyDesktopFiles,
  type DesktopEvidence,
} from "../src/desktopEvidence.ts";
import { publishDesktop } from "../src/desktopPublish.ts";
import { wranglerBucket } from "./bucket.ts";

const [command, path, root, option] = process.argv.slice(2);
if (command === "names") {
  if (!path) throw new Error("Expected a desktop release tag");
  for (const platform of desktopPlatforms)
    for (const name of desktopReleaseFiles(platform, path))
      console.log(root ? join(root, desktopArtifact(platform), name) : name);
  process.exit(0);
}
if (!path || !root)
  throw new Error(
    "usage: desktop-release.ts <admit|verify|finalize-windows|verify-published|publish|rollback> <provenance.json> <installer directory> [--pending-windows|<signed build digest>]\n       desktop-release.ts names <tag> [installer directory]",
  );
const record = JSON.parse(await readFile(path, "utf8"));
if (command === "admit") {
  if (option !== undefined && option !== "--pending-windows")
    throw new Error("Unknown desktop admission option");
  record.desktop = await admitDesktop(root, record.source, record.releaseTag, option !== undefined);
  await writeFile(path, JSON.stringify(record) + "\n");
} else {
  const proof = record.desktop as DesktopEvidence | undefined;
  if (!proof || proof.source !== record.source || proof.tag !== record.releaseTag) {
    throw new Error("Release provenance does not admit these desktop installers");
  }
  if (command === "finalize-windows") {
    record.desktop = await finalizeWindowsDesktop(root, proof, option ?? "");
    await verifyDesktopFiles(root, record.desktop);
    await writeFile(path, JSON.stringify(record) + "\n");
    process.exit(0);
  }
  const flat = command === "rollback" || command === "verify-published";
  await verifyDesktopFiles(
    root,
    proof,
    flat,
    command === "verify" && option === "--pending-windows",
  );
  if (command === "publish" || command === "rollback") {
    const rollback = command === "rollback";
    const channel = rollback
      ? process.env["WAVE_UPDATE_CHANNEL"]
      : proof.tag.endsWith("-ti")
        ? "ti"
        : "main";
    if (channel !== "ti" && channel !== "main") throw new Error("Expected a release channel");
    const published = await publishDesktop({
      proof,
      root,
      rollback,
      channel,
      bucket: wranglerBucket(),
      signingKey: createPrivateKey(process.env["WAVE_DESKTOP_UPDATE_SIGNING_KEY"] ?? ""),
      notes: JSON.parse(process.env["WAVE_DESKTOP_NOTES"] || '{"en":{"new":[],"fixes":[]}}'),
    });
    console.log(
      published
        ? `Published the desktop update for ${proof.tag}`
        : "Keeping the channel's newer publication",
    );
  } else if (command !== "verify" && command !== "verify-published") {
    throw new Error("Unknown desktop release command");
  }
}
