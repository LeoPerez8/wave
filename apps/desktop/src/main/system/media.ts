/** The OS speaks milliseconds here; only the native adapter converts its time units. */
export interface MediaView {
  readonly state: string;
  readonly positionMs: number;
  readonly durationMs: number;
  readonly song: {
    readonly key: string;
    readonly title: string;
    readonly artist: string;
    readonly album: string;
    readonly coverUrl: string | null;
  } | null;
}
export interface MediaCommand {
  readonly action: string;
  readonly value?: number;
}

export const createMediaIntegration = (port: {
  readonly view: () => MediaView;
  readonly play: () => Promise<void>;
  readonly pause: () => Promise<void>;
  readonly skip: (action: "next" | "previous") => Promise<void>;
  readonly seek: (ms: number) => Promise<void>;
  readonly show: () => void;
  readonly quit: () => void;
  readonly publish: (view: MediaView) => void;
}) => ({
  update: () => port.publish(port.view()),
  command: async ({ action, value }: MediaCommand) => {
    const view = port.view();
    switch (action) {
      case "raise":
        port.show();
        return;
      case "quit":
        port.quit();
        return;
      case "play":
        await port.play();
        return;
      case "pause":
        await port.pause();
        return;
      case "toggle":
        await (view.state === "playing" ? port.pause() : port.play());
        return;
      case "next":
      case "previous":
        await port.skip(action);
        return;
      case "seek":
      case "seekBy":
        if (value === undefined || !Number.isFinite(value) || !view.song) return;
        await port.seek(
          Math.max(
            0,
            Math.min(view.durationMs, action === "seekBy" ? view.positionMs + value : value),
          ),
        );
    }
  },
});
