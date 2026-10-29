import { describeFolder, type Catalogue } from "@wave/core";

/**
 * Names the scan roots in copy, in [strings]' language: "your Músicas folder"
 * or "your 3 music folders" (Portuguese takes its preposition along).
 */
export const folderPhrase = (
  roots: readonly { readonly path: string }[],
  strings: Catalogue,
): string => {
  const [only] = roots;
  if (roots.length === 1 && only !== undefined)
    return strings.library.oneFolder(describeFolder(only.path).name);
  return strings.library.folders(roots.length);
};
