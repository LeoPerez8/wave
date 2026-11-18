/** Desktop scan paths keep their spelling; only Windows identity folds case. */
export const scanPath = (path: string, platform: string): string => {
  const slashed = platform === "win32" ? path.replaceAll("\\", "/") : path;
  const prefix = slashed.startsWith("//") ? "//" : slashed.startsWith("/") ? "/" : "";
  const protectedParts = platform === "win32" && prefix === "//" ? 2 : 0;
  const parts: string[] = [];
  for (const part of slashed.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > protectedParts && !parts.at(-1)!.endsWith(":")) parts.pop();
    else if (part !== "..") parts.push(part);
  }
  const result = prefix + parts.join("/");
  return /^[A-Za-z]:$/.test(result) ? `${result}/` : result || "/";
};

export const scanPathKey = (path: string, platform: string): string => {
  const normalized = scanPath(path, platform);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
};

export interface ScanFolder {
  readonly path: string;
  readonly available: boolean;
}

export const scanPathWithin = (path: string, folder: string, platform: string): boolean => {
  const key = scanPathKey(path, platform);
  const parent = scanPathKey(folder, platform);
  return key === parent || key.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
};

/** `seen` holds scanPathKey values, built once during discovery. */
export const scanFileState = (
  path: string,
  roots: readonly ScanFolder[],
  seen: ReadonlySet<string>,
  platform: string,
): "present" | "missing" | "unavailable" | "outside" => {
  const covering = roots.filter((root) => scanPathWithin(path, root.path, platform));
  if (covering.length === 0) return "outside";
  if (!covering.some((root) => root.available)) return "unavailable";
  return seen.has(scanPathKey(path, platform)) ? "present" : "missing";
};
