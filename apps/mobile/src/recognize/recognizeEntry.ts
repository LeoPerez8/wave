import { recognizeEntryAction, type RecognizeMatch, type RecognizeSource } from "@wave/core";

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

export const followRecognizeMatches = <T>(
  inbox: {
    readonly take: () => T | null;
    readonly subscribe: (listener: () => void) => () => void;
  },
  open: (match: T) => void,
): (() => void) => {
  const receive = (): void => {
    const match = inbox.take();
    if (match !== null) open(match);
  };
  const stop = inbox.subscribe(receive);
  receive();
  return stop;
};

type RecognizeOpening = RecognizeSource | "auto" | RecognizeMatch;

/** All entry points share this card lifetime, including before React mounts it. */
export const createRecognizeEntry = (deps: {
  readonly foreground: () => boolean;
  readonly show: (source: RecognizeOpening, closed: () => void) => void | (() => void);
}) => {
  let cardOpen = false;
  let dismiss: (() => void) | void;
  let generation = 0;
  let pending: RecognizeOpening | null = null;
  const resume = (): void => {
    const action = recognizeEntryAction({
      pending: pending !== null,
      foreground: deps.foreground(),
      cardOpen,
    });
    if (action === "wait") return;
    const source = pending!;
    pending = null;
    if (action === "keep" && typeof source !== "object") return;
    const current = ++generation;
    if (typeof dismiss === "function") dismiss();
    cardOpen = true;
    dismiss = deps.show(source, () => {
      if (current === generation) cardOpen = false;
    });
  };
  return {
    request: (source: RecognizeOpening = "auto"): void => {
      pending = source;
      resume();
    },
    resume,
  };
};
