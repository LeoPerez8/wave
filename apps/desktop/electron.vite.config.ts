import { createPublicKey } from "node:crypto";
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

const channel = process.env["WAVE_DESKTOP_CHANNEL"];
const publicKey = process.env["WAVE_DESKTOP_UPDATE_PUBLIC_KEY"];
const release = channel === "ti" || channel === "main";
if (release && (!publicKey || createPublicKey(publicKey).asymmetricKeyType !== "ed25519")) {
  throw new Error("A desktop release needs the Ed25519 update public key");
}

export default defineConfig({
  main: {
    define: {
      WAVE_DESKTOP_BUILD: JSON.stringify(
        release ? { channel, publicKey, builtAt: Date.now() } : null,
      ),
    },
    // Only the SQLite binding and updater are runtime dependencies. Workspace code, Drizzle,
    // and Effect are bundled, so electron-builder does not walk Drizzle's optional peers.
    // The audio process is a second entry, forked from main as a utility process.
    build: {
      externalizeDeps: { exclude: ["@wave/client", "@wave/core"] },
      rolldownOptions: {
        input: { index: "src/main/index.ts", audio: "src/main/audio/process.ts" },
      },
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
    // The mini player is a second page of the same renderer.
    build: {
      rolldownOptions: {
        input: { index: "src/renderer/index.html", mini: "src/renderer/mini.html" },
      },
    },
  },
});
