// CI reports each build's APK size and Hermes bundle size against a budget (docs/spec.md,
// "Build and CI"; #712, Startup and size). The budget is the first measured release's size
// plus a headroom, kept in size-budget.json. Being over it is a warning, never a failure.
//   node scripts/ci/app-size.ts <apk> <bundle> [<markdown>]
// prints a ::warning:: line for each size over its budget and the report's markdown, and
// writes the markdown to [<markdown>] for the sticky comment and the job summary.
// Reads WAVE_SIZE_BUDGET (default: size-budget.json beside this script).
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface SizeBudget {
  /** The release the sizes were measured from. */
  release: string;
  apkBytes: number;
  bundleBytes: number;
  /** How much each may grow past that release before it's over budget (0.05 = 5%). */
  headroom: number;
}

export interface Sizes {
  apkBytes: number;
  bundleBytes: number;
}

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(2)} MB`;
/** [text], an absolute amount, signed as [value] is; no sign when it shows as zero. */
const signed = (text: string, value: number): string =>
  Number.parseFloat(text) === 0 ? text : `${value > 0 ? "+" : "-"}${text}`;

/** The sticky comment's size table, and the names of the sizes over their budget. */
export const sizeReport = (
  sizes: Sizes,
  budget: SizeBudget,
): { markdown: string; over: string[]; warnings: string[] } => {
  const headroom = `${Math.round(budget.headroom * 100)}%`;
  const rows = [
    { name: "APK", label: "The APK", bytes: sizes.apkBytes, baseline: budget.apkBytes },
    {
      name: "Hermes bundle",
      label: "The Hermes bundle",
      bytes: sizes.bundleBytes,
      baseline: budget.bundleBytes,
    },
  ].map((row) => ({ ...row, limit: Math.floor(row.baseline * (1 + budget.headroom)) }));
  const over = rows.filter((row) => row.bytes > row.limit);
  const lines = rows.map(({ name, bytes, baseline, limit }) => {
    const change = bytes - baseline;
    const percent = (Math.abs(change) / baseline) * 100;
    const since = `${signed(mb(Math.abs(change)), change)} (${signed(`${percent.toFixed(1)}%`, change)})`;
    const against =
      bytes > limit ? `⚠️ ${mb(limit)}, over by ${mb(bytes - limit)}` : `✅ ${mb(limit)}`;
    return `| ${name} | ${mb(bytes)} | ${against} | ${since} |`;
  });
  return {
    markdown: [
      `**App size** (budget: ${budget.release} + ${headroom})`,
      "",
      `| | Size | Budget | Since ${budget.release} |`,
      "| --- | --: | --: | --: |",
      ...lines,
    ].join("\n"),
    over: over.map((row) => row.name),
    warnings: over.map(
      (row) =>
        `${row.label} is ${mb(row.bytes)}, over its ${mb(row.limit)} budget (${budget.release} + ${headroom}).`,
    ),
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [apk, bundle, out] = process.argv.slice(2);
  if (apk === undefined || bundle === undefined)
    throw new Error("Usage: node scripts/ci/app-size.ts <apk> <bundle> [<markdown>]");
  const budget = JSON.parse(
    readFileSync(
      process.env.WAVE_SIZE_BUDGET || new URL("./size-budget.json", import.meta.url),
      "utf8",
    ),
  ) as SizeBudget;
  const { markdown, warnings } = sizeReport(
    { apkBytes: statSync(apk).size, bundleBytes: statSync(bundle).size },
    budget,
  );
  for (const warning of warnings) console.log(`::warning::${warning}`);
  console.log(markdown);
  if (out !== undefined) writeFileSync(out, `${markdown}\n`);
}
