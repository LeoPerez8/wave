/**
 * How the Library's synchronous writes run on the JS thread: as they are,
 * unless the app names each one for the block log (`runLibraryWritesWith`),
 * so a JS block over 50 ms during a scan's save, its cleanup or the lyrics
 * index says which write held the thread (#1436).
 */
let runWrite: <A>(operation: string, run: () => A) => A = (_operation, run) => run();

/** Runs the write [operation] through what the app set (`runLibraryWritesWith`). */
export const runLibraryWrite = <A>(operation: string, run: () => A): A => runWrite(operation, run);

/** Runs every Library write through [runner], given the write's operation. */
export const runLibraryWritesWith = (runner: <A>(operation: string, run: () => A) => A): void => {
  runWrite = runner;
};
