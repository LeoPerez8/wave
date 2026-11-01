import {
  recognizeEntryAction,
  type RecognizeMatch,
  type RecognizeSource,
  type YtSong,
} from "@wave/core";

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

export type RecognizeOpening<S extends YtSong = YtSong> =
  | { readonly kind: "capture"; readonly source: RecognizeSource | "auto" }
  | { readonly kind: "match"; readonly match: RecognizeMatch<S> };

/** All entry points share this card lifetime, including before React mounts it. */
export const createRecognizeEntry = <S extends YtSong = YtSong>(deps: {
  readonly foreground: () => boolean;
  readonly cancelTile: () => void;
  readonly show: (source: RecognizeOpening<S>, closed: () => void) => void | (() => void);
}) => {
  let cardOpen = false;
  let dismiss: (() => void) | void;
  let generation = 0;
  let pending: RecognizeOpening<S> | null = null;
  const resume = (): void => {
    const action = recognizeEntryAction({
      pending: pending !== null,
      opening: pending?.kind ?? "capture",
      foreground: deps.foreground(),
      cardOpen,
    });
    if (action === "wait") return;
    const source = pending!;
    pending = null;
    if (action === "keep") return;
    if (source.kind === "capture") deps.cancelTile();
    const current = ++generation;
    if (typeof dismiss === "function") dismiss();
    cardOpen = true;
    dismiss = deps.show(source, () => {
      if (current === generation) cardOpen = false;
    });
  };
  return {
    request: (source: RecognizeOpening<S> = { kind: "capture", source: "auto" }): void => {
      pending = source;
      resume();
    },
    resume,
  };
};
