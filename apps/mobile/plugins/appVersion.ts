// Wave's version lives in app.config.ts. Android's versionCode is derived from
// it, and a release tag must name it (docs/spec.md, Releases).

const VERSION = /^(\d+)\.(\d{1,2})\.(\d{1,2})(?:-ti)?$/;

/**
 * Android's versionCode for `major.minor.patch`: major × 10000 + minor × 100 + patch,
 * so 0.5.0 is 500 and each version installs over the one before. Minor and patch stay
 * under 100, or two versions would share a code. A test version's -ti suffix
 * doesn't change the numeric code, so its stable version can install over it.
 */
export const versionCode = (version: string): number => {
  const parts = VERSION.exec(version);
  if (!parts) {
    throw new Error(
      `Wave's version must be major.minor.patch (optionally -ti), with minor and patch under 100: "${version}"`,
    );
  }
  const [major = 0, minor = 0, patch = 0] = parts.slice(1).map(Number);
  return major * 10000 + minor * 100 + patch;
};

/** The branch a validated app version is released from. */
export const releaseBranch = (version: string): "main" | "ti" =>
  version.endsWith("-ti") ? "ti" : "main";

/** Why `tag` can't release the app at `version`, or undefined when it names it. */
export const releaseTagProblem = (tag: string, version: string): string | undefined => {
  if (tag === `v${version}`) return undefined;
  return (
    `The tag ${tag} doesn't match the app's version, ${version} (apps/mobile/app.config.ts). ` +
    "Bump the version in a PR first, then tag its merge commit v<version>; " +
    `or tag v${version} to release ${version}.`
  );
};
