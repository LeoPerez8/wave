export interface AuditOptions {
  /** Declaration identities: `path#name`, or `package#name` for a dependency's export. */
  readonly librarySeeds: readonly string[];
  readonly networkSeeds: readonly string[];
  readonly roots: readonly string[];
  readonly boundaries?: readonly string[];
}
export interface SourceUse {
  readonly owner: string;
  readonly capability: string;
  readonly via: readonly string[];
}
export interface SourceAudit {
  library: SourceUse[];
  network: SourceUse[];
  boundaries: string[];
  missingSeeds: string[];
  /** Each owner's references: the owners it names and the library seeds it uses. */
  follows: ReadonlyMap<string, ReadonlySet<string>>;
}
export const mobileSources: (root: string) => Record<string, string>;
export const auditSources: (
  files: Readonly<Record<string, string>>,
  options: AuditOptions,
) => SourceAudit;
export const rowSubscriptions: (
  audit: SourceAudit,
  options: {
    readonly isRow: (owner: string) => boolean;
    readonly hooks: readonly string[];
    readonly stores: readonly string[];
  },
) => SourceUse[];
/** `capability` is `literal` (a file or artwork-provider URI) or `rawPath`; `via` its code. */
export const handBuiltArtwork: (files: Readonly<Record<string, string>>) => SourceUse[];
