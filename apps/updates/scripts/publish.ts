// Publishes a release's update to R2. CI's release job runs it.
//   node apps/updates/scripts/publish.ts <update dir>
// <update dir> holds `expo export`'s output and expo-config.json (`expo config --type public`).
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, WAVE_UPDATE_CHANNEL, WAVE_RUNTIME_VERSION.
// Without the secrets, or with no channel, it says why and publishes nothing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isChannel } from "../src/layout.ts";
import { publishUpdate } from "../src/publish.ts";
import { wranglerBucket } from "./bucket.ts";

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
  const id = await publishUpdate({
    dir,
    channel,
    runtimeVersion,
    appConfig: JSON.parse(readFileSync(join(dir, "expo-config.json"), "utf8")),
    ...wranglerBucket(),
  });
  console.log(`Published update ${id} to ${channel} for runtime version ${runtimeVersion}.`);
}
