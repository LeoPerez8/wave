import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LINUX_MIME_TYPES,
  OPEN_WITH_EXTENSIONS,
  windowsOpenWithScript,
} from "../scripts/file-types.ts";
import { PLAYABLE_EXTENSIONS } from "./shared/playback.ts";

test("Wave offers to open every audio format the engine plays, and no video", () => {
  assert.deepEqual(OPEN_WITH_EXTENSIONS, ["mp3", "m4a", "flac", "ogg", "oga", "opus", "wav"]);
  // A format the engine gains must be offered too; MP4 stays out, as most are videos.
  assert.deepEqual(
    PLAYABLE_EXTENSIONS.filter((extension) => !OPEN_WITH_EXTENSIONS.includes(extension)),
    ["mp4"],
  );
});

test("the Windows installer lists Wave under Open with and takes no file type's default", () => {
  const script = windowsOpenWithScript();
  const [install, uninstall] = script.split("!macro customUnInstall");
  assert.match(install!, /^!macro customInstall\r?\n/);
  assert.match(
    install!,
    /WriteRegStr HKCU "Software\\Classes\\Wave\.AudioFile\\shell\\open\\command" "" '"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" "%1"'/,
  );
  for (const extension of OPEN_WITH_EXTENSIONS) {
    assert.ok(
      install!.includes(
        `WriteRegStr HKCU "Software\\Classes\\.${extension}\\OpenWithProgids" "Wave.AudioFile" ""`,
      ),
      `${extension} lists Wave`,
    );
    assert.ok(
      install!.includes(
        `WriteRegStr HKCU "Software\\Classes\\Applications\\\${APP_EXECUTABLE_FILENAME}\\SupportedTypes" ".${extension}" ""`,
      ),
      `Wave says it opens ${extension}`,
    );
    assert.ok(
      uninstall!.includes(
        `DeleteRegValue HKCU "Software\\Classes\\.${extension}\\OpenWithProgids" "Wave.AudioFile"`,
      ),
      `uninstalling takes Wave off ${extension}`,
    );
  }
  // The default handler is the extension key's own value: the script never writes or deletes it.
  assert.doesNotMatch(script, /"Software\\Classes\\\.[a-z0-9]+" /);
  assert.doesNotMatch(script, /DeleteRegKey HKCU "Software\\Classes\\\./);
  assert.doesNotMatch(script, /mp4/);
  assert.match(uninstall!, /DeleteRegKey HKCU "Software\\Classes\\Wave\.AudioFile"/);
  assert.equal(script.match(/^!macroend$/gm)?.length, 2);
});

test("the AppImage's desktop entry declares the same formats", () => {
  // The types the system's MIME database gives each extension (shared-mime-info), and aliases.
  for (const type of [
    "audio/mpeg",
    "audio/mp4",
    "audio/flac",
    "audio/x-vorbis+ogg",
    "audio/ogg",
    "audio/x-opus+ogg",
    "audio/x-wav",
  ])
    assert.ok(LINUX_MIME_TYPES.includes(type), type);
  assert.equal(new Set(LINUX_MIME_TYPES).size, LINUX_MIME_TYPES.length);
  assert.ok(LINUX_MIME_TYPES.every((type) => type.startsWith("audio/")));
});

test("the release packaging uses both", () => {
  const packaging = readFileSync(new URL("../scripts/package-release.ts", import.meta.url), "utf8");
  assert.match(packaging, /include: openWith,/);
  assert.match(packaging, /writeFileSync\(openWith, windowsOpenWithScript\(\)\)/);
  assert.match(packaging, /linux: \{ category: "AudioVideo", mimeTypes: LINUX_MIME_TYPES \}/);
});
