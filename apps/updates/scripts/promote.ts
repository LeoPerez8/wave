// Rolls a channel back to a version R2 still keeps. The Roll back an update workflow runs it.
//   node apps/updates/scripts/promote.ts
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, UPDATES_SIGNING_KEY, WAVE_UPDATE_CHANNEL,
// WAVE_UPDATE_VERSION. Anything that stops it fails the run and says why as an error annotation.
// A promotion is a new manifest, so with no key it stops rather than promote something unsigned.
import { isChannel } from "../src/layout.ts";
import { promoteUpdate } from "../src/promote.ts";
import { wranglerBucket } from "./bucket.ts";

const {
  CLOUDFLARE_API_TOKEN: token,
  CLOUDFLARE_ACCOUNT_ID: account,
  UPDATES_SIGNING_KEY: signingKey,
  WAVE_UPDATE_CHANNEL: channel = "",
  WAVE_UPDATE_VERSION: rawVersion = "",
} = process.env;
// The tag's name works as well as the version.
const version = rawVersion.trim().replace(/^v/, "");

const stop = (reason: string): never => {
  console.log(`::error::${reason}`);
  process.exit(1);
};

if (!token || !account) {
  stop("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID aren't set (apps/updates/README.md).");
} else if (!signingKey) {
  stop(
    "UPDATES_SIGNING_KEY isn't set, and phones reject an unsigned update, so nothing was " +
      "promoted (docs/spec.md, Build and CI).",
  );
} else if (!isChannel(channel)) {
  stop(`"${channel}" isn't a release channel.`);
} else if (version === "") {
  stop("No version given.");
} else {
  try {
    const id = await promoteUpdate({ channel, version, signingKey, ...wranglerBucket() });
    console.log(`${channel} now gives its phones ${version}, as update ${id}.`);
  } catch (error) {
    stop(error instanceof Error ? error.message : String(error));
  }
}
