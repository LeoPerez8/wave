import { describeFolder } from "@wave/core";

/** Names the scan roots in copy: "your Músicas folder" or "your 3 music folders". */
export const folderPhrase = (roots: readonly { readonly path: string }[]): string => {
  const [only] = roots;
  if (roots.length === 1 && only !== undefined)
    return `your ${describeFolder(only.path).name} folder`;
  return roots.length === 0 ? "your music folders" : `your ${roots.length} music folders`;
};
