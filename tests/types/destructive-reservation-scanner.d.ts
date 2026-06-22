declare module "../scripts/security/destructive-reservation-scanner.mjs" {
  export type DestructiveViolation = {
    file: string;
    line: number;
    rule: string;
  };

  export type ScanFileEntry = {
    absolutePath: string;
    relativePath: string;
  };

  export function lineFromIndex(text: string, index: number): number;
  export function scanSource(relativePath: string, source: string): DestructiveViolation[];
  export function scanWorkspace(
    rootPath?: string,
    scanRoots?: string[]
  ): { files: ScanFileEntry[]; violations: DestructiveViolation[] };
}
