/**
 * dotdiff core — normalize-then-compare for config files.
 *
 * Everything here is pure and deterministic: no I/O, no network, no globals.
 * The whole promise of the tool ("reordering or reindenting a file produces
 * ZERO diff") lives in normalizeKV() / normalizeRaw(), so those are the
 * functions to read first.
 */

export interface Options {
  mode: 'kv' | 'raw';
  ignoreKeyCase: boolean;
  ignoreQuotes: boolean;
  ignoreInlineComments: boolean;
  emptyEqualsUnset: boolean;
  dedupeRaw: boolean;
}

export const defaultOptions: Options = {
  mode: 'kv',
  ignoreKeyCase: false,
  ignoreQuotes: false,
  ignoreInlineComments: false,
  emptyEqualsUnset: false,
  dedupeRaw: false,
};

/** A single parsed entry, kept with its display key and raw source line. */
export interface Entry {
  /** Key exactly as written (used for display). */
  rawKey: string;
  /** Key after case-folding when ignoreKeyCase is on (used for matching). */
  matchKey: string;
  /** Value after the active normalizations (used for both display + match). */
  value: string;
  /** 1-based line number in the original text. */
  line: number;
}

export interface ParsedSide {
  /** matchKey -> entries. More than one entry means a duplicate key. */
  map: Map<string, Entry[]>;
  /** Entries in original file order, for the validator. */
  entries: Entry[];
}

const COMMENT_LINE = /^\s*(#|;|\/\/)/;

/** True for a whole-line comment or a blank line. */
function isSkippable(line: string): boolean {
  const t = line.trim();
  return t === '' || COMMENT_LINE.test(t);
}

/**
 * Strip a trailing inline comment introduced by " #" or " ;".
 * Only strips when the marker is preceded by whitespace, so URLs with '#'
 * fragments and values that legitimately contain '#' are left alone unless
 * they are clearly a comment. Never strips inside quotes.
 */
function stripInlineComment(value: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if ((ch === '#' || ch === ';') && !inSingle && !inDouble) {
      // require preceding whitespace (or start) so "a#b" stays intact
      if (i === 0 || /\s/.test(value[i - 1])) {
        return value.slice(0, i).trimEnd();
      }
    }
  }
  return value;
}

/** Remove one matching pair of surrounding single or double quotes. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Parse one side of KEY=VALUE input into a normalized, sorted structure.
 * Blank lines and whole-line comments are ignored. Key and value are trimmed.
 * Ordering never matters because we key everything into a map and sort by key
 * at render time.
 */
export function parseKV(text: string, opts: Options): ParsedSide {
  const map = new Map<string, Entry[]>();
  const entries: Entry[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isSkippable(line)) continue;

    // Split on the FIRST '=' or ':' so values may contain the delimiter.
    const eq = firstDelimiterIndex(line);
    if (eq === -1) continue; // not a key=value line; skip quietly

    const rawKey = line.slice(0, eq).trim();
    if (rawKey === '') continue;

    let value = line.slice(eq + 1).trim();
    if (opts.ignoreInlineComments) value = stripInlineComment(value).trimEnd();
    if (opts.ignoreQuotes) value = unquote(value);

    const matchKey = opts.ignoreKeyCase ? rawKey.toLowerCase() : rawKey;

    const entry: Entry = { rawKey, matchKey, value, line: i + 1 };
    entries.push(entry);
    const bucket = map.get(matchKey);
    if (bucket) bucket.push(entry);
    else map.set(matchKey, [entry]);
  }

  return { map, entries };
}

/** Index of the first '=' or ':' that acts as the key/value delimiter. */
function firstDelimiterIndex(line: string): number {
  const eq = line.indexOf('=');
  const colon = line.indexOf(':');
  if (eq === -1) return colon;
  if (colon === -1) return eq;
  return Math.min(eq, colon);
}

/** Effective value used for comparison, honoring emptyEqualsUnset. */
function comparableValue(v: string | undefined, opts: Options): string | undefined {
  if (v === undefined) return opts.emptyEqualsUnset ? '' : undefined;
  if (opts.emptyEqualsUnset && v === '') return '';
  return v;
}

export interface KVRow {
  key: string; // display key (from whichever side has it, A preferred)
  aValue?: string;
  bValue?: string;
}

export interface KVResult {
  onlyInA: KVRow[];
  onlyInB: KVRow[];
  changed: KVRow[];
  identical: KVRow[];
}

/** Diff two parsed KV sides by key into the four buckets. */
export function diffKV(a: ParsedSide, b: ParsedSide, opts: Options): KVResult {
  const onlyInA: KVRow[] = [];
  const onlyInB: KVRow[] = [];
  const changed: KVRow[] = [];
  const identical: KVRow[] = [];

  const keys = new Set<string>([...a.map.keys(), ...b.map.keys()]);
  const sorted = [...keys].sort((x, y) => x.localeCompare(y));

  for (const key of sorted) {
    const aEntry = a.map.get(key)?.[0];
    const bEntry = b.map.get(key)?.[0];
    const display = aEntry?.rawKey ?? bEntry?.rawKey ?? key;

    const aVal = aEntry?.value;
    const bVal = bEntry?.value;
    const cmpA = comparableValue(aVal, opts);
    const cmpB = comparableValue(bVal, opts);

    if (aEntry && !bEntry) {
      // present in A only — unless emptyEqualsUnset makes an empty A match a
      // truly-absent B (both comparable to ''), which is still "only in A"
      // because B has no key at all. Keep it in onlyInA.
      onlyInA.push({ key: display, aValue: aVal });
    } else if (!aEntry && bEntry) {
      onlyInB.push({ key: display, bValue: bVal });
    } else {
      // present on both sides
      if (cmpA === cmpB) {
        identical.push({ key: display, aValue: aVal, bValue: bVal });
      } else {
        changed.push({ key: display, aValue: aVal, bValue: bVal });
      }
    }
  }

  return { onlyInA, onlyInB, changed, identical };
}

// ---------------------------------------------------------------------------
// RAW-TEXT (set difference) mode
// ---------------------------------------------------------------------------

export interface RawResult {
  onlyInA: string[];
  onlyInB: string[];
  commonCount: number;
}

/** Trim each line, drop blanks, sort, optionally de-dup. */
export function normalizeRaw(text: string, opts: Options): string[] {
  let lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  lines.sort((a, b) => a.localeCompare(b));
  if (opts.dedupeRaw) {
    const seen = new Set<string>();
    lines = lines.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
  }
  return lines;
}

/**
 * Multiset-aware set difference so duplicates are handled sanely:
 * "line appears twice in A, once in B" -> once only-in-A.
 */
export function diffRaw(aLines: string[], bLines: string[]): RawResult {
  const aCount = counts(aLines);
  const bCount = counts(bLines);
  const onlyInA: string[] = [];
  const onlyInB: string[] = [];
  let commonCount = 0;

  const all = new Set<string>([...aCount.keys(), ...bCount.keys()]);
  const sorted = [...all].sort((x, y) => x.localeCompare(y));
  for (const line of sorted) {
    const ca = aCount.get(line) ?? 0;
    const cb = bCount.get(line) ?? 0;
    const common = Math.min(ca, cb);
    commonCount += common;
    for (let i = 0; i < ca - cb; i++) onlyInA.push(line);
    for (let i = 0; i < cb - ca; i++) onlyInB.push(line);
  }
  return { onlyInA, onlyInB, commonCount };
}

function counts(lines: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export type HintKind = 'url' | 'port' | 'boolean' | 'number' | 'secret' | null;

/** Best-effort, clearly-heuristic classification of a value. */
export function valueHint(value: string): HintKind {
  const v = value.trim();
  if (v === '') return null;
  if (/^https?:\/\/\S+$/i.test(v) || /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(v)) return 'url';
  if (/^(true|false|yes|no|on|off|0|1)$/i.test(v)) {
    // '0'/'1' are ambiguous; only call boolean for the wordy ones
    if (/^(true|false|yes|no|on|off)$/i.test(v)) return 'boolean';
  }
  if (/^\d{1,5}$/.test(v)) {
    const n = Number(v);
    if (n >= 0 && n <= 65535 && v.length <= 5) return 'port';
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return 'number';
  // probable secret: long, high-entropy-ish, or looks like a token/key
  if (probableSecret(v)) return 'secret';
  return null;
}

function probableSecret(v: string): boolean {
  if (v.length >= 20 && /[A-Za-z]/.test(v) && /\d/.test(v)) return true;
  if (/^(sk|pk|rk|xox[baprs]|ghp|gho|github_pat|AKIA|ASIA)[-_A-Za-z0-9]{8,}/.test(v)) return true;
  if (/^[A-Za-z0-9+/]{32,}={0,2}$/.test(v)) return true; // base64-ish blob
  if (/-----BEGIN [A-Z ]+-----/.test(v)) return true;
  return false;
}

export interface SideIssues {
  duplicates: { key: string; count: number; lines: number[] }[];
  emptyValues: { key: string; line: number }[];
  hints: { key: string; kind: HintKind }[];
}

export function validateSide(side: ParsedSide): SideIssues {
  const duplicates: SideIssues['duplicates'] = [];
  const emptyValues: SideIssues['emptyValues'] = [];
  const hints: SideIssues['hints'] = [];

  for (const [, bucket] of side.map) {
    if (bucket.length > 1) {
      duplicates.push({
        key: bucket[0].rawKey,
        count: bucket.length,
        lines: bucket.map((e) => e.line),
      });
    }
    const first = bucket[0];
    if (first.value.trim() === '') {
      emptyValues.push({ key: first.rawKey, line: first.line });
    } else {
      const kind = valueHint(first.value);
      if (kind) hints.push({ key: first.rawKey, kind });
    }
  }
  duplicates.sort((a, b) => a.key.localeCompare(b.key));
  emptyValues.sort((a, b) => a.key.localeCompare(b.key));
  hints.sort((a, b) => a.key.localeCompare(b.key));
  return { duplicates, emptyValues, hints };
}

export interface DriftResult {
  missingFromB: string[]; // keys in A, absent in B
  missingFromA: string[]; // keys in B, absent in A
}

/** Drift = the #1 real-world .env bug: a key set on one side but not the other. */
export function computeDrift(a: ParsedSide, b: ParsedSide): DriftResult {
  const missingFromB = [...a.map.keys()].filter((k) => !b.map.has(k)).sort((x, y) => x.localeCompare(y));
  const missingFromA = [...b.map.keys()].filter((k) => !a.map.has(k)).sort((x, y) => x.localeCompare(y));
  return { missingFromB, missingFromA };
}

/** Which of the required keys are missing from a side. */
export function missingRequired(side: ParsedSide, required: string[], ignoreCase: boolean): string[] {
  const have = new Set([...side.map.keys()].map((k) => (ignoreCase ? k.toLowerCase() : k)));
  return required
    .map((r) => r.trim())
    .filter((r) => r !== '')
    .filter((r) => !have.has(ignoreCase ? r.toLowerCase() : r));
}

// ---------------------------------------------------------------------------
// Report text (for copy / download)
// ---------------------------------------------------------------------------

export function summaryLine(kv: KVResult): string {
  const parts = [
    `${kv.onlyInA.length} only in A`,
    `${kv.onlyInB.length} only in B`,
    `${kv.changed.length} changed`,
    `${kv.identical.length} identical`,
  ];
  return parts.join(', ');
}

export function rawSummaryLine(raw: RawResult): string {
  return `${raw.onlyInA.length} only in A, ${raw.onlyInB.length} only in B, ${raw.commonCount} in common`;
}

/** Dot-mask a value for secret-safe display: keep length signal, hide content. */
export function maskValue(v: string): string {
  if (v === '') return '(empty)';
  const n = Math.min(v.length, 24);
  return '•'.repeat(n);
}
