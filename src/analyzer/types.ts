export type FindingSeverity = 'blocker' | 'warning' | 'info';

/** A deterministic analyzer finding with a Persian explanation and a concrete fix. */
export interface AnalyzerWarning {
  code: string;
  severity: FindingSeverity;
  messageFa: string;
  fixFa: string;
  /** File or package that triggered it, e.g. `index.js:12` or `package.json: nodemon`. */
  evidence?: string;
}
