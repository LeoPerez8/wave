export interface AuditOptions {
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
export const mobileSources: (root: string) => Record<string, string>;
export const auditSources: (
  files: Readonly<Record<string, string>>,
  options: AuditOptions,
) => { library: SourceUse[]; network: SourceUse[]; boundaries: string[]; missingSeeds: string[] };
/** Every `useMemo`/`useCallback` dependency its function doesn't read, as `file#owner: hook [dep]`. */
export const unreadMemoDependencies: (files: Readonly<Record<string, string>>) => string[];
