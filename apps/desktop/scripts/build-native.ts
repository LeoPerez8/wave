/**
 * Builds the audio engine's Node addon (`native/node`) and copies it to
 * `native/wave-audio.node`, where main finds it; on Linux also the system media controls'
 * addon (`native/media`), to `native/wave-media.node`. Honours `CARGO_BUILD_TARGET`.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { join } from "node:path";

const native = join(import.meta.dirname, "..", "native");
// The media addon is MPRIS; Windows' media controls come from Chromium's Media Session.
const withMedia = process.platform === "linux";
const built = spawnSync(
  "cargo",
  [
    "build",
    "--release",
    "--locked",
    "-p",
    "wave-audio-node",
    ...(withMedia ? ["-p", "wave-media-node"] : []),
  ],
  { cwd: native, stdio: "inherit" },
);
if (built.status !== 0) process.exit(built.status ?? 1);

const target = process.env["CARGO_BUILD_TARGET"];
const folder = join(
  native,
  "target",
  ...(target === undefined || target === "" ? [] : [target]),
  "release",
);
const library =
  process.platform === "win32"
    ? "wave_audio_node.dll"
    : process.platform === "darwin"
      ? "libwave_audio_node.dylib"
      : "libwave_audio_node.so";
copyFileSync(join(folder, library), join(native, "wave-audio.node"));
if (withMedia) copyFileSync(join(folder, "libwave_media_node.so"), join(native, "wave-media.node"));
console.log(`Built ${join(native, "wave-audio.node")}`);
