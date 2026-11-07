// The PR autofix's trusted half. The Autofix job installs and formats the PR with a read-only
// token and hands over its changes as a patch; this applies that patch only when it holds
// nothing but a lockfile update and formatting. A file other than the lockfile passes only if
// its patched text is exactly what the formatter makes of the PR's text, and the formatter
// comes from the base branch, never from the PR. New, deleted, renamed, re-moded, binary and
// linked files are refused.
//   node scripts/ci/autofix-patch.ts <patch> <PR checkout>
// Run from a checkout of the base branch with its dependencies installed. Prints the applied
// files, one per line, and leaves them staged in the PR checkout. Exits 2 with the reason when
// it refuses, leaving the PR checkout untouched.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Verdict = { ok: true; files: string[] } | { ok: false; reason: string };

export type AutofixPatch = {
  /** The patch file the Autofix job made. */
  patch: string;
  /** The PR's checkout, at the commit the patch was made from. */
  repo: string;
  /** The base branch's formatter: what `pnpm fmt` makes of a file's text. */
  format: (path: string, text: string) => string;
};

const lockfile = "pnpm-lock.yaml";
// Regular files, executable or not; links and submodules aren't formatting.
const formattableModes = new Set(["100644", "100755"]);

export function applyAutofixPatch({ patch, repo, format }: AutofixPatch): Verdict {
  const git = (args: string[], env?: NodeJS.ProcessEnv) =>
    execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
  const refuse = (reason: string): Verdict => ({ ok: false, reason });

  if (readFileSync(patch, "utf8").trim() === "") return { ok: true, files: [] };
  let numstat: string;
  let summary: string;
  try {
    numstat = git(["apply", "--numstat", "-z", patch]);
    summary = git(["apply", "--summary", patch]);
  } catch {
    return refuse("The patch couldn't be read.");
  }
  const entries = numstat.split("\0").filter(Boolean);
  if (summary.trim() !== "")
    return refuse(`The patch adds, deletes, renames or re-modes a file:\n${summary.trim()}`);

  const files: string[] = [];
  for (const entry of entries) {
    const [added, deleted, path] = entry.split("\t");
    if (!path) return refuse("The patch renames or copies a file.");
    if (added === "-" || deleted === "-") return refuse(`\`${path}\` is a binary change.`);
    files.push(path);
  }
  files.sort();

  // The patched text, from a scratch index on the PR's head: the PR checkout isn't touched.
  const scratch = mkdtempSync(join(tmpdir(), "autofix-index-"));
  try {
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    git(["read-tree", "HEAD"], env);
    try {
      git(["apply", "--cached", patch], env);
    } catch {
      return refuse("The patch doesn't apply to the PR's head.");
    }
    for (const path of files) {
      if (path === lockfile) continue;
      const mode = git(["ls-tree", "HEAD", "--", path]).split(" ")[0] ?? "";
      if (!formattableModes.has(mode)) return refuse(`\`${path}\` isn't a regular file.`);
      const before = git(["show", `HEAD:${path}`]);
      const after = git(["show", `:${path}`], env);
      let formatted: string;
      try {
        formatted = format(path, before);
      } catch {
        return refuse(`The formatter couldn't format \`${path}\`.`);
      }
      if (after !== formatted)
        return refuse(`\`${path}\`: the change isn't only formatting or a lockfile update.`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  git(["apply", "--index", patch]);
  return { ok: true, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [patch, repo] = process.argv.slice(2);
  if (!patch || !repo) {
    console.error("Usage: node scripts/ci/autofix-patch.ts <patch> <PR checkout>");
    process.exit(1);
  }
  const base = process.cwd();
  const prettier = join(base, "node_modules/.bin/prettier");
  const verdict = applyAutofixPatch({
    patch: resolve(patch),
    repo: resolve(repo),
    // Prettier reads the base's config and ignore files for this path, as `pnpm fmt` would.
    format: (path, text) =>
      execFileSync(prettier, ["--stdin-filepath", path], {
        cwd: base,
        encoding: "utf8",
        input: text,
        stdio: ["pipe", "pipe", "pipe"],
      }),
  });
  if (!verdict.ok) {
    console.log(verdict.reason);
    process.exit(2);
  }
  for (const file of verdict.files) console.log(file);
}
