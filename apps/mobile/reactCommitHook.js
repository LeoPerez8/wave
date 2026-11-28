/**
 * React's commits for the JS block log (#1531). A Metro polyfill (metro.config.js), so it runs
 * before every module: React's renderer looks for `__REACT_DEVTOOLS_GLOBAL_HOOK__` once, as it
 * loads, and its production build then tells the hook each time it committed a render
 * (`onCommitFiberRoot`, after the layout effects) and ran its passive effects
 * (`onPostCommitFiberRoot`). This hook only passes those two moments on to
 * `globalThis.__waveReactCommits`, which `src/lib/jsEntries.ts` fills in.
 *
 * Nothing else: React calls `onCommitFiberUnmount` for every fiber it deletes when the hook has
 * one, and only react-dom calls `checkDCE`, so neither is here.
 *
 * Release builds only: a debug build has React DevTools' own hook, which this must not replace.
 */
(function (target) {
  if (__DEV__ || typeof target.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== "undefined") return;
  var listeners = { committed: null, effectsRan: null };
  var renderers = 0;
  target.__waveReactCommits = listeners;
  target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    inject: function () {
      renderers += 1;
      return renderers;
    },
    onCommitFiberRoot: function () {
      var committed = listeners.committed;
      if (committed !== null) committed();
    },
    onPostCommitFiberRoot: function () {
      var effectsRan = listeners.effectsRan;
      if (effectsRan !== null) effectsRan();
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : global);
