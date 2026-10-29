export interface TextFinding {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
}
export const TEXT_ALLOWLIST: readonly string[];
export function isTextSource(file: string): boolean;
export function findUntranslatedText(file: string, source: string): TextFinding[];
