const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const { withUniwindConfig } = require("uniwind/metro");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);

// Inline requires (#727): a module loads where one of its imports is first read, not when the
// module importing it loads, so what the first screen doesn't use waits for its first use.
const getTransformOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async (...args) => {
  const options = await getTransformOptions(...args);
  return { ...options, transform: { ...options.transform, inlineRequires: true } };
};

// React's commits reach the JS block log through a hook its renderer finds as it loads, so the
// hook goes in before every module (#1531, reactCommitHook.js).
const getPolyfills = config.serializer.getPolyfills;
config.serializer.getPolyfills = (options) => {
  const polyfills = getPolyfills(options);
  return options.platform ? [...polyfills, path.join(__dirname, "reactCommitHook.js")] : polyfills;
};

// Perf profiler builds (#1423): React's profiling renderer, so `<Profiler>`'s `onRender` runs in a
// release bundle (`src/lib/renderCost.tsx`). Never in a build that ships.
if (
  process.env.EXPO_PUBLIC_WAVE_PERF === "1" &&
  process.env.EXPO_PUBLIC_WAVE_PERF_PROFILER === "1"
) {
  const resolveRequest = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const name = moduleName.endsWith("/implementations/ReactFabric-prod")
      ? moduleName.replace(/-prod$/, "-profiling")
      : moduleName;
    return (resolveRequest ?? context.resolveRequest)(context, name, platform);
  };
}

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
});
