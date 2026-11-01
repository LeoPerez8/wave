// Publishes a release's notes in each language to R2. CI's release job runs it.
//   node apps/updates/scripts/publish-notes.ts
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, WAVE_UPDATE_CHANNEL, WAVE_RELEASE_TAG (the
// `v` tag), WAVE_RELEASE_NOTES (the JSON scripts/ci/localized-notes.ts prints).
// Without the secrets, a channel or the notes, it says why and publishes nothing.
import { isChannel } from "../src/layout.ts";
import { publishNotes } from "../src/publish.ts";
import { wranglerBucket } from "./bucket.ts";

const {
  CLOUDFLARE_API_TOKEN: token,
  CLOUDFLARE_ACCOUNT_ID: account,
  WAVE_UPDATE_CHANNEL: channel = "",
  WAVE_RELEASE_TAG: tag = "",
  WAVE_RELEASE_NOTES: notes = "",
} = process.env;
const version = tag.replace(/^v/, "");

if (!token || !account) {
  console.log(
    "Skipping the release notes: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID aren't set " +
      "(apps/updates/README.md). The release itself is published as usual.",
  );
} else if (!isChannel(channel)) {
  console.log(`Skipping the release notes: "${channel}" isn't a release channel.`);
} else if (notes === "") {
  console.log(`Skipping the release notes: ${version} has none in each language.`);
} else {
  const published = await publishNotes({
    channel,
    version,
    notes: JSON.parse(notes),
    put: wranglerBucket().put,
  });
  console.log(
    published
      ? `Published the notes of ${version} to ${channel}.`
      : `Skipping the release notes: ${version} lists no PR.`,
  );
}
