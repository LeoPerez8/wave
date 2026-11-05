// Wave's version lives in the `version` field of apps/mobile/package.json, which
// app.config.ts reads. Android's versionCode is derived from it, and a release tag must
// name it (docs/spec.md, Releases).

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

/**
 * Why `tag` can't release the app at `version`, or undefined when it names it. A stable tag can
 * name a commit at the same number's -ti version: a promotion, which builds it without the suffix.
 */
export const releaseTagProblem = (tag: string, version: string): string | undefined => {
  if (tag === `v${version}` || `${tag}-ti` === `v${version}`) return undefined;
  return (
    `The tag ${tag} doesn't match the app's version, ${version} (apps/mobile/package.json). ` +
    "Pushes to main release their next version on their own; a tag by hand must " +
    `name the version of the commit it tags: tag this one v${version}, or tag the "Release Wave <version>" commit you want.`
  );
};
