/** The offer of a downloaded APK, and the version line What's New shares with Settings. */
export const appUpdatesEn = {
  updateTheApp: "Update the app",
  ignoreThisUpdate: "Ignore This Update",
  version: (version: string): string => `Version ${version}`,
  checkForUpdates: "Check for updates",
  percent: (percent: number): string => `${percent}%`,
  downloading: (percent: number): string => `Downloading the update, ${percent}%`,
  upToDate: "Wave is up to date",
  bundleOnItsWay: "An update is on its way. It applies once Wave is in the background.",
  checkFailed: "Couldn't check for updates",
  downloadFailed: "Couldn't download the update",
  installFailed: "Couldn't install the update",
  mobileDataTitle: "Download the update on mobile data?",
  mobileDataMessage: (size: string): string =>
    `It downloads about ${size}, and the phone isn't on Wi-Fi.`,
  download: "Download",
  notNow: "Not now",
};
