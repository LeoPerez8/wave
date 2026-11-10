/**
 * The card's Android settings visit, independent of React's render lifetime.
 * `Result` is what Wave reads of the links on return (the Settings row's line).
 */
export const createSongLinksRunner = <Result>({
  openSettings,
  subscribeVisibility,
  close,
  answered,
  readHandling,
  report,
}: {
  readonly openSettings: () => Promise<void>;
  readonly subscribeVisibility: (changed: (visible: boolean) => void) => () => void;
  readonly close: () => void;
  readonly answered: () => void;
  readonly readHandling: () => Result;
  readonly report: (handling: Result) => void;
}) => {
  let state: "open" | "visiting" | "done" = "open";
  let stop: (() => void) | undefined;

  const returned = (): void => {
    if (state !== "visiting") return;
    state = "done";
    stop?.();
    close();
    report(readHandling());
  };

  return {
    turnOn: (): void => {
      if (state !== "open") return;
      state = "visiting";
      // The press is an answer even if Wave is killed while Android settings is up.
      answered();
      let left = false;
      stop = subscribeVisibility((visible) => {
        if (!visible) left = true;
        else if (left) returned();
      });
      void openSettings().catch(returned);
    },
    answer: (): void => {
      if (state === "done") return;
      const unanswered = state === "open";
      state = "done";
      stop?.();
      close();
      if (unanswered) answered();
    },
  };
};
