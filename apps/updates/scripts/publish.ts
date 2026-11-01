// Publishes a release's update to R2. CI's release job runs it from a sparse checkout, with no
// install: wrangler comes through npx.
//   node apps/updates/scripts/publish.ts <update dir>
// <update dir> holds `expo export`'s output and expo-config.json (`expo config --type public`).
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, WAVE_UPDATE_CHANNEL, WAVE_RUNTIME_VERSION.
// Without the secrets, or with no channel, it says why and publishes nothing.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isChannel } from "../src/layout.ts";
import { publishUpdate } from "../src/publish.ts";

const BUCKET = "wave-updates";

const {
  CLOUDFLARE_API_TOKEN: token,
  CLOUDFLARE_ACCOUNT_ID: account,
  WAVE_UPDATE_CHANNEL: channel = "",
  WAVE_RUNTIME_VERSION: runtimeVersion = "",
} = process.env;
const dir = process.argv[2] ?? "";

if (!token || !account) {
  console.log(
    "Skipping the over-the-air update: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID aren't " +
      "set (apps/updates/README.md). The release itself is published as usual.",
  );
} else if (!isChannel(channel)) {
  console.log(`Skipping the over-the-air update: "${channel}" isn't a release channel.`);
} else {
  const temp = join(mkdtempSync(join(tmpdir(), "wave-publish-")), "object");
  const id = await publishUpdate({
    dir,
    channel,
    runtimeVersion,
    appConfig: JSON.parse(readFileSync(join(dir, "expo-config.json"), "utf8")),
    put: async (key, data, contentType) => {
      writeFileSync(temp, data);
      console.log(`Uploading ${key} (${data.length} bytes)`);
      execFileSync(
        "npx",
        [
          "--yes",
          "wrangler@4",
          "r2",
          "object",
          "put",
          `${BUCKET}/${key}`,
          "--remote",
          "--file",
          temp,
          "--content-type",
          contentType,
        ],
        { stdio: ["ignore", "ignore", "inherit"] },
      );
    },
  });
  console.log(`Published update ${id} to ${channel} for runtime version ${runtimeVersion}.`);
}
