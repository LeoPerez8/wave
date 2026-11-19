import { createPrivateKey } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { admitDesktop, verifyDesktopFiles, type DesktopEvidence } from "../src/desktopEvidence.ts";
import { publishDesktop } from "../src/desktopPublish.ts";
import { wranglerBucket } from "./bucket.ts";

const [command, path, root] = process.argv.slice(2);
if (!path || !root)
  throw new Error(
    "usage: desktop-release.ts <admit|verify|verify-published|publish|rollback> <provenance.json> <installer directory>",
  );
const record = JSON.parse(await readFile(path, "utf8"));
if (command === "admit") {
  record.desktop = await admitDesktop(root, record.source, record.releaseTag);
  await writeFile(path, JSON.stringify(record) + "\n");
} else {
  const proof = record.desktop as DesktopEvidence | undefined;
  if (!proof || proof.source !== record.source || proof.tag !== record.releaseTag) {
    throw new Error("Release provenance does not admit these desktop installers");
  }
  const flat = command === "rollback" || command === "verify-published";
  await verifyDesktopFiles(root, proof, flat);
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
