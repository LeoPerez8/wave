// Every CI build names itself in the app log next to its version (docs/spec.md, "Build and
// CI"): a PR build as `PR #438 @ 90970e3`, a push to main as `main @ 1a2b3c4`, a promotion as `v0.5.0 @ 1a2b3c4`. bundle.sh's
// Metro run inlines it as EXPO_PUBLIC_WAVE_BUILD_LABEL, so a full build and a repack both
// carry the label of the run that made them.
//   node scripts/ci/build-label.ts     `EXPO_PUBLIC_WAVE_BUILD_LABEL=…`, for $GITHUB_ENV
// Reads PR_NUMBER (empty off PRs), GITHUB_REF_NAME and HEAD_SHA (the commit the APK is built from).
import { fileURLToPath } from "node:url";

/** The label of a build from `sha`: its PR's, else its branch's or tag's, and the short commit. */
export const buildLabel = ({
  prNumber,
  refName,
  sha,
}: {
  prNumber: string;
  refName: string;
  sha: string;
}): string => {
  if (sha === "") throw new Error("A build label needs the commit the APK is built from.");
  const commit = sha.slice(0, 7);
  if (prNumber !== "") return `PR #${prNumber} @ ${commit}`;
  if (refName !== "") return `${refName} @ ${commit}`;
  return commit;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const label = buildLabel({
    prNumber: process.env.PR_NUMBER ?? "",
    refName: process.env.GITHUB_REF_NAME ?? "",
    sha: process.env.HEAD_SHA ?? "",
  });
  console.log(`EXPO_PUBLIC_WAVE_BUILD_LABEL=${label}`);
}
