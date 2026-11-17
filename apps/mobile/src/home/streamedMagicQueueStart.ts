/** Starts from the stream only when the targeted Library lookup fails. */
export const startFromLibraryMatch = <A>(
  readMatch: Promise<A>,
  start: (match: A | null) => void,
): Promise<void> => readMatch.then(start, () => start(null));
