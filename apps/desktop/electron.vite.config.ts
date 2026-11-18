import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import { contentSecurityPolicy } from "./src/main/security.ts";

/** Puts the window's CSP in its page, so the built file and the dev server both carry it. */
const csp = (): Plugin => ({
  name: "wave-csp",
  transformIndexHtml: (_html, context) => [
    {
      tag: "meta",
      attrs: {
        "http-equiv": "Content-Security-Policy",
        content: contentSecurityPolicy(context.server !== undefined),
      },
      injectTo: "head-prepend",
    },
  ],
});

export default defineConfig({
  main: {
    // Workspace packages are TypeScript source, so they go in the bundle; better-sqlite3 stays
    // outside it with its native binding.
    // The audio process is a second entry, forked from main as a utility process.
    build: {
      externalizeDeps: { exclude: ["@wave/client", "@wave/core"] },
      rolldownOptions: { input: { index: "src/main/index.ts", audio: "src/main/audio/process.ts" } },
    },
  },
  preload: {
    // A sandboxed preload must be one CommonJS file.
    build: {
      externalizeDeps: false,
      rolldownOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss(), csp()],
  },
});
