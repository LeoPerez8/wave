/// <reference types="node" />
// Fails a release before anything is built when its tag doesn't name the app's version.
//   node scripts/check-release-tag.ts <tag> <app version>
// CI passes the version `expo config` reads from package.json through app.config.ts
// (scripts/ci/check-release-tag.sh).
import { releaseBranch, releaseTagProblem, versionCode } from "../plugins/appVersion.ts";

const [tag = "", version = ""] = process.argv.slice(2);

const problem = releaseTagProblem(tag, version);
if (problem) {
  console.error(problem);
  process.exit(1);
}
const code = versionCode(version);
if (process.argv.includes("--branch")) console.log(releaseBranch(version));
else console.log(`Releasing Wave ${version} (versionCode ${code}) from ${tag}.`);
