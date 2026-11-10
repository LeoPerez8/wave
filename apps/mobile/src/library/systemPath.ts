/**
 * What expo-router does with a link Android hands Wave (`+native-intent.tsx`). A song or playlist
 * link tapped in another app (the `https`/`http` VIEW filter in app.config.ts) reaches React
 * Native's Linking too, which would route `https://music.youtube.com/watch?…` to an unmatched
 * `/watch`. The native inbox carries that link to `openSharedText` instead (docs/spec.md, "Opening
 * a song link"), so the router starts Wave at its root, or leaves an open Wave where it is (null
 * means no navigation). Wave's own `wave://` links route as before.
 */
export const routedSystemPath = ({
  path,
  initial,
}: {
  readonly path: string;
  readonly initial: boolean;
}): string | null => {
  if (!/^https?:/iu.test(path)) return path;
  return initial ? "/" : null;
};
