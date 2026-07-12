/**
 * dotdiff client island. Wires the DOM to the pure logic in lib/diff.ts.
 * 100% local: no fetch, no network, nothing leaves the page. The strict CSP
 * (connect-src 'none') makes that a browser-enforced guarantee.
 */
import {
  defaultOptions,
  parseKV,
  diffKV,
  normalizeRaw,
  diffRaw,
  validateSide,
  computeDrift,
  missingRequired,
  valueHint,
  summaryLine,
  rawSummaryLine,
  maskValue,
  type Options,
  type KVResult,
  type KVRow,
  type RawResult,
  type ParsedSide,
  type HintKind,
} from '../lib/diff';
import { SAMPLE_A, SAMPLE_B, SAMPLE_REQUIRED } from '../lib/sample';

// ---- tiny DOM helpers -----------------------------------------------------
const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};
const $$ = <T extends HTMLElement = HTMLElement>(sel: string): T[] =>
  Array.from(document.querySelectorAll<T>(sel));

function el(tag: string, className?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

// ---- state ----------------------------------------------------------------
const inputA = $<HTMLTextAreaElement>('#input-a');
const inputB = $<HTMLTextAreaElement>('#input-b');
const requiredInput = $<HTMLTextAreaElement>('#required-keys');

let opts: Options = { ...defaultOptions };
let mask = false;
let lastReport = '';

// Read toggle state from the DOM checkboxes.
function readOptions(): Options {
  const mode = ($('input[name="mode"]:checked') as HTMLInputElement).value as 'kv' | 'raw';
  return {
    mode,
    ignoreKeyCase: ($<HTMLInputElement>('#opt-case')).checked,
    ignoreQuotes: ($<HTMLInputElement>('#opt-quotes')).checked,
    ignoreInlineComments: ($<HTMLInputElement>('#opt-comments')).checked,
    emptyEqualsUnset: ($<HTMLInputElement>('#opt-empty')).checked,
    dedupeRaw: ($<HTMLInputElement>('#opt-dedupe')).checked,
  };
}

// ---- value rendering ------------------------------------------------------
function renderValue(v: string | undefined): string {
  if (v === undefined) return '—';
  if (mask) return maskValue(v);
  if (v === '') return '(empty)';
  return v;
}

const HINT_LABEL: Record<Exclude<HintKind, null>, string> = {
  url: 'url',
  port: 'port',
  boolean: 'bool',
  number: 'num',
  secret: 'secret',
};

// ---- KV diff render -------------------------------------------------------
function renderKV(a: ParsedSide, b: ParsedSide, result: KVResult): void {
  const out = $('#diff-output');
  out.innerHTML = '';

  const summary = summaryLine(result);
  setSummary(
    [
      { n: result.onlyInA.length, label: 'only in A', cls: 'stat-a' },
      { n: result.onlyInB.length, label: 'only in B', cls: 'stat-b' },
      { n: result.changed.length, label: 'changed', cls: 'stat-c' },
      { n: result.identical.length, label: 'identical', cls: 'stat-i' },
    ],
    summary,
  );

  const noise =
    result.onlyInA.length === 0 && result.onlyInB.length === 0 && result.changed.length === 0;
  if (noise && result.identical.length > 0) {
    out.appendChild(
      banner(
        'twins',
        `No meaningful differences. ${result.identical.length} key${
          result.identical.length === 1 ? '' : 's'
        } match on both sides — ordering and whitespace were ignored.`,
      ),
    );
  }

  if (result.changed.length) {
    out.appendChild(
      bucketHeader('change', 'Different value', result.changed.length, 'same key, different value'),
    );
    const body = el('div', 'bucket-body');
    for (const row of result.changed) body.appendChild(changedRow(row));
    out.appendChild(body);
  }

  if (result.onlyInA.length) {
    out.appendChild(bucketHeader('remove', 'Only in A', result.onlyInA.length, 'missing from B'));
    const body = el('div', 'bucket-body');
    for (const row of result.onlyInA) body.appendChild(oneSideRow(row.key, row.aValue, 'a'));
    out.appendChild(body);
  }

  if (result.onlyInB.length) {
    out.appendChild(bucketHeader('add', 'Only in B', result.onlyInB.length, 'missing from A'));
    const body = el('div', 'bucket-body');
    for (const row of result.onlyInB) body.appendChild(oneSideRow(row.key, row.bValue, 'b'));
    out.appendChild(body);
  }

  if (result.identical.length) {
    out.appendChild(identicalBlock(result.identical));
  }

  if (
    !result.changed.length &&
    !result.onlyInA.length &&
    !result.onlyInB.length &&
    !result.identical.length
  ) {
    out.appendChild(emptyState('Paste a config into A and B to see the diff.'));
  }

  lastReport = buildKVReport(result, summary);
}

function changedRow(row: KVRow): HTMLElement {
  const r = el('div', 'row row-change');
  r.appendChild(keyCell(row.key, 'change'));
  const vals = el('div', 'row-vals');
  const a = el('div', 'val val-a');
  a.appendChild(sideTag('A'));
  a.appendChild(el('span', 'val-text', renderValue(row.aValue)));
  const b = el('div', 'val val-b');
  b.appendChild(sideTag('B'));
  b.appendChild(el('span', 'val-text', renderValue(row.bValue)));
  vals.appendChild(a);
  vals.appendChild(b);
  r.appendChild(vals);
  return r;
}

function oneSideRow(key: string, value: string | undefined, side: 'a' | 'b'): HTMLElement {
  const r = el('div', `row row-${side === 'a' ? 'remove' : 'add'}`);
  r.appendChild(keyCell(key, side === 'a' ? 'remove' : 'add'));
  const vals = el('div', 'row-vals');
  const v = el('div', `val val-${side}`);
  v.appendChild(sideTag(side.toUpperCase()));
  v.appendChild(el('span', 'val-text', renderValue(value)));
  vals.appendChild(v);
  r.appendChild(vals);
  return r;
}

function keyCell(key: string, kind: 'add' | 'remove' | 'change'): HTMLElement {
  const c = el('div', 'row-key');
  const sign = kind === 'add' ? '+' : kind === 'remove' ? '−' : '~';
  c.appendChild(el('span', `sign sign-${kind}`, sign));
  c.appendChild(el('span', 'key-name', key));
  return c;
}

function sideTag(label: string): HTMLElement {
  return el('span', `side-tag side-tag-${label.toLowerCase()}`, label);
}

function identicalBlock(rows: KVRow[]): HTMLElement {
  const wrap = el('details', 'identical');
  const sum = el('summary', 'bucket-header header-identical');
  sum.appendChild(el('span', 'header-title', 'Identical'));
  sum.appendChild(el('span', 'header-count tnum', String(rows.length)));
  sum.appendChild(el('span', 'header-note', 'same on both sides — collapsed'));
  wrap.appendChild(sum);
  const body = el('div', 'bucket-body');
  for (const row of rows) {
    const r = el('div', 'row row-identical');
    r.appendChild(keyCell(row.key, 'change'));
    const vals = el('div', 'row-vals');
    const v = el('div', 'val val-both');
    v.appendChild(el('span', 'val-text', renderValue(row.aValue)));
    vals.appendChild(v);
    r.appendChild(vals);
    body.appendChild(r);
  }
  wrap.appendChild(body);
  return wrap;
}

// ---- RAW diff render ------------------------------------------------------
function renderRaw(result: RawResult): void {
  const out = $('#diff-output');
  out.innerHTML = '';
  const summary = rawSummaryLine(result);
  setSummary(
    [
      { n: result.onlyInA.length, label: 'only in A', cls: 'stat-a' },
      { n: result.onlyInB.length, label: 'only in B', cls: 'stat-b' },
      { n: result.commonCount, label: 'in common', cls: 'stat-i' },
    ],
    summary,
  );

  if (result.onlyInA.length) {
    out.appendChild(bucketHeader('remove', 'Only in A', result.onlyInA.length, 'lines absent from B'));
    const body = el('div', 'bucket-body');
    for (const line of result.onlyInA) body.appendChild(rawLine(line, 'a'));
    out.appendChild(body);
  }
  if (result.onlyInB.length) {
    out.appendChild(bucketHeader('add', 'Only in B', result.onlyInB.length, 'lines absent from A'));
    const body = el('div', 'bucket-body');
    for (const line of result.onlyInB) body.appendChild(rawLine(line, 'b'));
    out.appendChild(body);
  }
  if (!result.onlyInA.length && !result.onlyInB.length) {
    out.appendChild(
      banner('twins', `Same set of lines on both sides (${result.commonCount} in common). Order ignored.`),
    );
  }
  lastReport = buildRawReport(result, summary);
}

function rawLine(line: string, side: 'a' | 'b'): HTMLElement {
  const r = el('div', `row row-${side === 'a' ? 'remove' : 'add'}`);
  const c = el('div', 'row-key raw-key');
  const sign = side === 'a' ? '−' : '+';
  c.appendChild(el('span', `sign sign-${side === 'a' ? 'remove' : 'add'}`, sign));
  c.appendChild(el('span', 'key-name', mask ? maskValue(line) : line));
  r.appendChild(c);
  return r;
}

// ---- shared render bits ---------------------------------------------------
function bucketHeader(
  kind: 'add' | 'remove' | 'change',
  title: string,
  count: number,
  note: string,
): HTMLElement {
  const h = el('div', `bucket-header header-${kind}`);
  h.appendChild(el('span', 'header-title', title));
  h.appendChild(el('span', 'header-count tnum', String(count)));
  h.appendChild(el('span', 'header-note', note));
  return h;
}

function banner(kind: string, text: string): HTMLElement {
  const b = el('div', `banner banner-${kind}`);
  b.appendChild(el('span', 'banner-dot', ''));
  b.appendChild(el('span', 'banner-text', text));
  return b;
}

function emptyState(text: string): HTMLElement {
  return el('div', 'empty-state', text);
}

interface Stat {
  n: number;
  label: string;
  cls: string;
}
function setSummary(stats: Stat[], plain: string): void {
  const bar = $('#summary');
  bar.innerHTML = '';
  bar.setAttribute('aria-label', 'Diff summary: ' + plain);
  for (const s of stats) {
    const chip = el('span', `stat ${s.cls}${s.n === 0 ? ' stat-zero' : ''}`);
    chip.appendChild(el('span', 'stat-n tnum', String(s.n)));
    chip.appendChild(el('span', 'stat-label', s.label));
    bar.appendChild(chip);
  }
}

// ---- validator render -----------------------------------------------------
function renderValidator(a: ParsedSide, b: ParsedSide, o: Options): void {
  const out = $('#validator-output');
  out.innerHTML = '';

  const drift = computeDrift(a, b);
  const issuesA = validateSide(a);
  const issuesB = validateSide(b);
  const required = requiredInput.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const reqMissA = missingRequired(a, required, o.ignoreKeyCase);
  const reqMissB = missingRequired(b, required, o.ignoreKeyCase);

  const totalProblems =
    drift.missingFromA.length +
    drift.missingFromB.length +
    issuesA.duplicates.length +
    issuesB.duplicates.length +
    issuesA.emptyValues.length +
    issuesB.emptyValues.length +
    reqMissA.length +
    reqMissB.length;

  const head = el('div', 'val-head');
  head.appendChild(el('span', 'val-head-title', 'Validator'));
  const badge = el(
    'span',
    `val-badge ${totalProblems === 0 ? 'ok' : 'warn'}`,
    totalProblems === 0 ? 'all clear' : `${totalProblems} issue${totalProblems === 1 ? '' : 's'}`,
  );
  head.appendChild(badge);
  out.appendChild(head);

  // DRIFT — highlighted as the headline problem
  if (drift.missingFromA.length || drift.missingFromB.length) {
    const sec = valSection('drift', 'Drift', 'keys set on one side but not the other');
    if (drift.missingFromB.length) {
      sec.appendChild(driftLine('In A, missing from B', drift.missingFromB, 'a'));
    }
    if (drift.missingFromA.length) {
      sec.appendChild(driftLine('In B, missing from A', drift.missingFromA, 'b'));
    }
    out.appendChild(sec);
  }

  // Required keys
  if (required.length) {
    if (reqMissA.length || reqMissB.length) {
      const sec = valSection('required', 'Missing required keys', 'from your required list');
      if (reqMissA.length) sec.appendChild(chipRow('A is missing', reqMissA, 'a'));
      if (reqMissB.length) sec.appendChild(chipRow('B is missing', reqMissB, 'b'));
      out.appendChild(sec);
    } else {
      const sec = valSection('required-ok', 'Required keys', 'all present on both sides');
      out.appendChild(sec);
    }
  }

  // Duplicates
  const dupA = issuesA.duplicates;
  const dupB = issuesB.duplicates;
  if (dupA.length || dupB.length) {
    const sec = valSection('dupe', 'Duplicate keys', 'later value usually wins — easy to miss');
    for (const d of dupA)
      sec.appendChild(
        issueLine('A', `${d.key} × ${d.count}`, `lines ${d.lines.join(', ')}`),
      );
    for (const d of dupB)
      sec.appendChild(
        issueLine('B', `${d.key} × ${d.count}`, `lines ${d.lines.join(', ')}`),
      );
    out.appendChild(sec);
  }

  // Empty values
  if (issuesA.emptyValues.length || issuesB.emptyValues.length) {
    const sec = valSection('empty', 'Empty values', 'set but with no value');
    for (const e of issuesA.emptyValues) sec.appendChild(issueLine('A', e.key, `line ${e.line}`));
    for (const e of issuesB.emptyValues) sec.appendChild(issueLine('B', e.key, `line ${e.line}`));
    out.appendChild(sec);
  }

  // Value hints (informational)
  const hintCount = issuesA.hints.length + issuesB.hints.length;
  if (hintCount) {
    const sec = valSection('hints', 'Value hints', 'heuristic — never sent anywhere');
    const merged = mergeHints(issuesA.hints, issuesB.hints);
    for (const [key, kind] of merged) sec.appendChild(hintLine(key, kind));
    out.appendChild(sec);
  }

  if (totalProblems === 0 && hintCount === 0) {
    out.appendChild(el('div', 'val-clear', 'No drift, no duplicates, no empty values. Looks healthy.'));
  }
}

function valSection(kind: string, title: string, note: string): HTMLElement {
  const s = el('div', `val-section val-${kind}`);
  const h = el('div', 'val-section-head');
  h.appendChild(el('span', 'val-section-title', title));
  h.appendChild(el('span', 'val-section-note', note));
  s.appendChild(h);
  return s;
}

function driftLine(label: string, keys: string[], side: 'a' | 'b'): HTMLElement {
  return chipRow(label, keys, side);
}

function chipRow(label: string, keys: string[], side: 'a' | 'b'): HTMLElement {
  const row = el('div', 'val-row');
  row.appendChild(el('span', `val-side val-side-${side}`, label));
  const chips = el('div', 'val-chips');
  for (const k of keys) chips.appendChild(el('span', 'val-chip', k));
  row.appendChild(chips);
  return row;
}

function issueLine(side: string, key: string, where: string): HTMLElement {
  const row = el('div', 'val-row val-issue');
  row.appendChild(el('span', `val-side val-side-${side.toLowerCase()}`, side));
  row.appendChild(el('span', 'val-issue-key', key));
  row.appendChild(el('span', 'val-issue-where', where));
  return row;
}

function hintLine(key: string, kind: Exclude<HintKind, null>): HTMLElement {
  const row = el('div', 'val-row val-hint');
  row.appendChild(el('span', `hint-tag hint-${kind}`, HINT_LABEL[kind]));
  row.appendChild(el('span', 'val-hint-key', key));
  return row;
}

function mergeHints(
  a: { key: string; kind: HintKind }[],
  b: { key: string; kind: HintKind }[],
): [string, Exclude<HintKind, null>][] {
  const m = new Map<string, Exclude<HintKind, null>>();
  for (const h of [...a, ...b]) if (h.kind) m.set(h.key, h.kind);
  return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0]));
}

// ---- report builders ------------------------------------------------------
function reportHeader(): string {
  const now = new Date().toISOString();
  return `dotdiff report — generated locally ${now}\n(no data left your device)\n`;
}

function buildKVReport(r: KVResult, summary: string): string {
  const L: string[] = [reportHeader(), '', `SUMMARY: ${summary}`, ''];
  const v = (x?: string) => (mask ? maskValue(x ?? '') : x === undefined ? '' : x);
  if (r.changed.length) {
    L.push(`~ DIFFERENT VALUE (${r.changed.length})`);
    for (const row of r.changed) L.push(`  ~ ${row.key}\n      A = ${v(row.aValue)}\n      B = ${v(row.bValue)}`);
    L.push('');
  }
  if (r.onlyInA.length) {
    L.push(`- ONLY IN A (${r.onlyInA.length})`);
    for (const row of r.onlyInA) L.push(`  - ${row.key} = ${v(row.aValue)}`);
    L.push('');
  }
  if (r.onlyInB.length) {
    L.push(`+ ONLY IN B (${r.onlyInB.length})`);
    for (const row of r.onlyInB) L.push(`  + ${row.key} = ${v(row.bValue)}`);
    L.push('');
  }
  if (r.identical.length) {
    L.push(`= IDENTICAL (${r.identical.length})`);
    for (const row of r.identical) L.push(`  = ${row.key} = ${v(row.aValue)}`);
    L.push('');
  }
  return L.join('\n');
}

function buildRawReport(r: RawResult, summary: string): string {
  const L: string[] = [reportHeader(), '', `SUMMARY: ${summary}`, ''];
  if (r.onlyInA.length) {
    L.push(`- ONLY IN A (${r.onlyInA.length})`);
    for (const line of r.onlyInA) L.push(`  - ${mask ? maskValue(line) : line}`);
    L.push('');
  }
  if (r.onlyInB.length) {
    L.push(`+ ONLY IN B (${r.onlyInB.length})`);
    for (const line of r.onlyInB) L.push(`  + ${mask ? maskValue(line) : line}`);
    L.push('');
  }
  L.push(`= IN COMMON: ${r.commonCount}`);
  return L.join('\n');
}

// ---- main recompute -------------------------------------------------------
function recompute(): void {
  opts = readOptions();
  toggleModeUI(opts.mode);

  if (opts.mode === 'kv') {
    const a = parseKV(inputA.value, opts);
    const b = parseKV(inputB.value, opts);
    const result = diffKV(a, b, opts);
    renderKV(a, b, result);
    renderValidator(a, b, opts);
  } else {
    const aLines = normalizeRaw(inputA.value, opts);
    const bLines = normalizeRaw(inputB.value, opts);
    const result = diffRaw(aLines, bLines);
    renderRaw(result);
    // In raw mode we still run the KV validator on a best-effort parse so the
    // drift/duplicate panel stays useful; but if inputs aren't key=value it
    // will simply find nothing. Hide it to avoid noise.
    $('#validator-panel').hidden = true;
    return;
  }
  $('#validator-panel').hidden = false;
}

function toggleModeUI(mode: 'kv' | 'raw'): void {
  const kvOnly = $$('.kv-only');
  for (const n of kvOnly) n.hidden = mode !== 'kv';
  const rawOnly = $$('.raw-only');
  for (const n of rawOnly) n.hidden = mode !== 'raw';
}

// ---- actions --------------------------------------------------------------
function copyReport(): void {
  const btn = $<HTMLButtonElement>('#btn-copy');
  const done = (msg: string) => {
    const orig = btn.dataset.label || btn.textContent || 'Copy report';
    btn.dataset.label = orig;
    btn.textContent = msg;
    btn.classList.add('flash');
    window.setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove('flash');
    }, 1400);
  };
  // navigator.clipboard is a same-origin API and does NOT violate connect-src.
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(lastReport).then(
      () => done('Copied ✓'),
      () => fallbackCopy(lastReport, done),
    );
  } else {
    fallbackCopy(lastReport, done);
  }
}

function fallbackCopy(text: string, done: (m: string) => void): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    done('Copied ✓');
  } catch {
    done('Copy failed');
  }
  document.body.removeChild(ta);
}

function downloadReport(): void {
  // Blob + object URL is entirely local; no network request is made.
  const blob = new Blob([lastReport], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dotdiff-report.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function loadSample(): void {
  inputA.value = SAMPLE_A;
  inputB.value = SAMPLE_B;
  requiredInput.value = SAMPLE_REQUIRED;
  recompute();
}

function clearAll(): void {
  inputA.value = '';
  inputB.value = '';
  recompute();
}

function swapSides(): void {
  const tmp = inputA.value;
  inputA.value = inputB.value;
  inputB.value = tmp;
  recompute();
}

// ---- wire up --------------------------------------------------------------
function debounce<T extends (...a: never[]) => void>(fn: T, ms: number): T {
  let t = 0;
  return ((...args: never[]) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  }) as T;
}

function init(): void {
  const recomputeDebounced = debounce(recompute, 140);
  inputA.addEventListener('input', recomputeDebounced);
  inputB.addEventListener('input', recomputeDebounced);
  requiredInput.addEventListener('input', recomputeDebounced);

  for (const cb of $$('.opt-toggle')) cb.addEventListener('change', recompute);
  for (const r of $$('input[name="mode"]')) r.addEventListener('change', recompute);

  $('#opt-mask').addEventListener('change', (e) => {
    mask = (e.target as HTMLInputElement).checked;
    document.body.classList.toggle('masked', mask);
    recompute();
  });

  $('#btn-copy').addEventListener('click', copyReport);
  $('#btn-download').addEventListener('click', downloadReport);
  $('#btn-sample').addEventListener('click', loadSample);
  $('#btn-clear').addEventListener('click', clearAll);
  $('#btn-swap').addEventListener('click', swapSides);

  // Preload sample so the tool explains itself on first load.
  loadSample();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
