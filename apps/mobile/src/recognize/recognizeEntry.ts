import { recognizeEntryAction, type RecognizeSource } from "@wave/core";

/** Subscribe before taking the cold-start request, so a warm request cannot fall between them. */
export const followRecognizeRequests = (
  inbox: {
    readonly take: () => boolean;
    readonly subscribe: (listener: () => void) => () => void;
  },
  open: () => void,
): (() => void) => {
  const receive = (): void => {
    if (inbox.take()) open();
  };
  const stop = inbox.subscribe(receive);
  receive();
  return stop;
};

/** All entry points share this card lifetime, including before React mounts it. */
export const createRecognizeEntry = (deps: {
  readonly foreground: () => boolean;
  readonly show: (source: RecognizeSource, closed: () => void) => void;
}) => {
  let cardOpen = false;
  let pending: RecognizeSource | null = null;
  const resume = (): void => {
    const action = recognizeEntryAction({
      pending: pending !== null,
      foreground: deps.foreground(),
      cardOpen,
    });
    if (action === "wait") return;
    const source = pending!;
    pending = null;
    if (action === "keep") return;
    cardOpen = true;
    deps.show(source, () => {
      cardOpen = false;
    });
  };
  return {
    request: (source: RecognizeSource = "microphone"): void => {
      pending = source;
      resume();
    },
    resume,
  };
};
