// R2 from CI, through wrangler: the jobs that use it run from a sparse checkout with no install,
// so it comes through npx. Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
// wrangler comes from the registry at run time and needs no signing key: it gets none in its env.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UpdateBucket } from "../src/release.ts";

const BUCKET = "wave-updates";

const wrangler = (...args: readonly string[]) => {
  const { UPDATES_SIGNING_KEY: _, ...env } = process.env;
  return execFileSync("npx", ["--yes", "wrangler@4", "r2", "object", ...args, "--remote"], {
    env,
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
};

export const wranglerBucket = (): UpdateBucket => {
  const temp = join(mkdtempSync(join(tmpdir(), "wave-updates-")), "object");
  return {
    put: async (key, data, contentType) => {
      writeFileSync(temp, data);
      console.log(`Uploading ${key} (${data.length} bytes)`);
      wrangler("put", `${BUCKET}/${key}`, "--file", temp, "--content-type", contentType);
    },
    read: async (key) => {
      try {
        wrangler("get", `${BUCKET}/${key}`, "--file", temp);
      } catch (error) {
        // Only this means "there's none": a network error mustn't read as an empty history.
        if (String((error as { stderr?: unknown }).stderr).includes("key does not exist")) {
          return null;
        }
        throw error;
      }
      return readFileSync(temp, "utf8");
    },
    remove: async (key) => {
      console.log(`Removing ${key}`);
      wrangler("delete", `${BUCKET}/${key}`);
    },
  };
};
