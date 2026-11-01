// The self-install spike's trigger (#886). `SelfInstallSpike.kt` lists everything to remove with it.

const RELEASES = "https://github.com/LeoPerez8/wave/releases/download";

/** Only test builds offer the trigger: a stable build's label, or an unknown one, doesn't. */
export const selfInstallSpikeAvailable = ({
  dev,
  buildLabel = "",
}: {
  dev: boolean;
  buildLabel: string | undefined;
}): boolean => dev || /^(PR #\d+|ti|v[^ ]+-ti) @ /.test(buildLabel);

/** The rolling APK of the channel this build came from, or nothing to suggest. */
export const selfInstallSpikeApkUrl = (buildLabel = ""): string => {
  const pr = /^PR #(\d+) @ /.exec(buildLabel)?.[1];
  if (pr !== undefined) return `${RELEASES}/pr-${pr}/wave-pr-${pr}.apk`;
  return /^(ti|v[^ ]+-ti) @ /.test(buildLabel) ? `${RELEASES}/ti-latest/wave-ti.apk` : "";
};
