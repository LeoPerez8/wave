// Which versioned release a CI push publishes, if any (docs/spec.md, Releases).
//   node scripts/ci/release-tag.ts <ref> <app version> < the repo's tag names, one per line
// Prints `tag=<tag>` for $GITHUB_OUTPUT, empty when nothing is released, and why on stderr.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { releaseBranch } from "../../apps/mobile/plugins/appVersion.ts";

type ReleaseDecision = { tag?: string; reason: string };

/**
 * A push to main or ti releases the app's version when `v<version>` isn't tagged yet and
 * the version belongs to that branch (`releaseBranch`). A hand-pushed tag releases itself.
 */
export const releaseTag = (push: {
  ref: string;
  version: string;
  tags: readonly string[];
}): ReleaseDecision => {
  // check-release-tag.sh has failed the run already if the tag doesn't name the version.
  const pushedTag = /^refs\/tags\/(v.+)$/.exec(push.ref)?.[1];
  if (pushedTag) return { tag: pushedTag, reason: `${pushedTag} was pushed by hand.` };
  const branch = /^refs\/heads\/(main|ti)$/.exec(push.ref)?.[1];
  if (!branch) return { reason: "Only pushes to main and ti publish a versioned release." };
  const tag = `v${push.version}`;
  const versionBranch = releaseBranch(push.version);
  if (versionBranch !== branch)
    return { reason: `${push.version} is released from ${versionBranch}, not ${branch}.` };
  if (push.tags.includes(tag)) return { reason: `${tag} already exists, so nothing is released.` };
  return { tag, reason: `${tag} doesn't exist yet: this run releases Wave ${push.version}.` };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [ref = "", version = ""] = process.argv.slice(2);
  const tags = readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
  const decision = releaseTag({ ref, version, tags });
  console.error(decision.reason);
  console.log(`tag=${decision.tag ?? ""}`);
}
