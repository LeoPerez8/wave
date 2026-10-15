import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [mode, ...extraArgs] = process.argv.slice(2);
if (!["full", "baseline"].includes(mode)) throw new Error("Expected full or baseline scan mode.");

function option(name, fallback) {
  let value = fallback;
  for (let index = 0; index < extraArgs.length; index++) {
    if (extraArgs[index] === name) value = extraArgs[++index];
    else if (extraArgs[index].startsWith(`${name}=`))
      value = extraArgs[index].slice(name.length + 1);
  }
  return value;
}

const reportPath = option("--json-out", `.cache/react-doctor/${mode}.json`);
mkdirSync(dirname(reportPath), { recursive: true });
// A failed process must never leave a previous successful report in use.
rmSync(reportPath, { force: true });
rmSync(`${reportPath}.md`, { force: true });

const cli = fileURLToPath(new URL("../bin/react-doctor.js", import.meta.resolve("react-doctor")));
const result = spawnSync(
  process.execPath,
  [
    cli,
    "apps/mobile",
    "--yes",
    "--scope",
    mode === "full" ? "full" : "changed",
    "--blocking",
    mode === "full" ? "none" : "error",
    ...(mode === "baseline" ? ["--include-untracked", "--base", "origin/main"] : []),
    ...extraArgs,
    "--json",
    "--json-out",
    reportPath,
  ],
  { stdio: "inherit" },
);
if (result.error) console.error(result.error.message);
const validation = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./react-doctor-report.mjs", import.meta.url)), reportPath, mode],
  { stdio: "inherit" },
);
if (validation.error) console.error(validation.error.message);
process.exitCode = (result.status ?? 1) || (validation.status ?? 1);
