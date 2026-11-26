/**
 * What an import compares a playlist with is the Library once the scan running now is through
 * (docs/spec.md, "Importing playlists from a link"): a first scan saves songs batch by batch, and
 * a Library read halfway would miss songs already on the phone, which the import then queues for
 * download. [running] gives the scan running now, or null; a scan that starts while one ends is
 * waited for too. Then [read] reads the Library.
 */
export const libraryOnceScanned = async <A>(
  running: () => Promise<unknown> | null,
  read: () => Promise<A>,
): Promise<A> => {
  for (let scan = running(); scan !== null; scan = running()) await scan.catch(() => undefined);
  return read();
};
