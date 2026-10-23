/**
 * The longest a recommendation read may run (a Magic Queue batch, a mix's
 * build, a playlist's suggestions): past it, the read fails and its surface
 * shows the retry line instead of loading on (docs/spec.md).
 */
export const RECOMMENDATION_TIMEOUT = "60 seconds";
