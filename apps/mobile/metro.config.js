const { getDefaultConfig } = require("expo/metro-config");
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

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
});
