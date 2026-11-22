/**
 * Whether a bundle is built with the React Compiler, from `EXPO_PUBLIC_WAVE_REACT_COMPILER` at
 * bundle time. On unless the build sets it to `0`, which builds the comparison's uncompiled side
 * (docs/performance/728-react-compiler.md). `app.config.ts` turns the compiler on from it, and a
 * perf build reports the same reading in its runs.
 */
export const reactCompilerOn = (value: string | undefined): boolean => value !== "0";
