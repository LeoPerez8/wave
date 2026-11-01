// Tells a channel's phones of the APK a release just published. CI's release job runs it.
//   node apps/updates/scripts/publish-apk.ts
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, WAVE_UPDATE_CHANNEL, WAVE_RUNTIME_VERSION,
// WAVE_RELEASE_TAG (the `v` tag), WAVE_APK_URL (the GitHub Release's), WAVE_APK_PATH.
// It never fails a release: anything missing or wrong is a log line, and phones stay on the last
// APK they were told of until the next release.
import { statSync } from "node:fs";
import { isChannel } from "../src/layout.ts";
import { publishLatestApk } from "../src/publish.ts";
import { wranglerBucket } from "./bucket.ts";

const {
  CLOUDFLARE_API_TOKEN: token,
  CLOUDFLARE_ACCOUNT_ID: account,
  WAVE_UPDATE_CHANNEL: channel = "",
  WAVE_RUNTIME_VERSION: runtimeVersion = "",
  WAVE_RELEASE_TAG: tag = "",
  WAVE_APK_URL: url = "",
  WAVE_APK_PATH: path = "",
} = process.env;
const version = tag.replace(/^v/, "");

if (!token || !account) {
  console.log(
    "Skipping the latest APK: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID aren't set " +
      "(apps/updates/README.md). The release itself is published as usual.",
  );
} else if (!isChannel(channel)) {
  console.log(`Skipping the latest APK: "${channel}" isn't a release channel.`);
} else if (url === "") {
  console.log(`Skipping the latest APK: the release of ${version} published no APK.`);
} else {
  try {
    await publishLatestApk({
      channel,
      apk: { version, runtimeVersion, url, size: statSync(path).size },
      put: wranglerBucket().put,
    });
    console.log(`Published ${version} as the latest APK of ${channel}.`);
  } catch (error) {
    console.log(`::warning::Couldn't publish the latest APK of ${channel}: ${String(error)}`);
  }
}
