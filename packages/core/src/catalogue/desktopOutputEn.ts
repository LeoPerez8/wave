/** Settings › Playback › Output on the desktop: the device Wave plays on. */
export const desktopOutputEn = {
  output: "Output",
  systemDefault: "System default",
  /** The output picked, in the list while it is unplugged. */
  notConnected: (name: string) => `${name} (not connected)`,
  hint: "The speakers or headphones Wave plays on. System default follows the output your system uses.",
  away: (name: string) =>
    `${name} isn't connected, so Wave plays on the system default. It goes back to ${name} when it's connected again.`,
};
