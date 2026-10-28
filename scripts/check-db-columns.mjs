#!/usr/bin/env node
// Scans app/, lib/, components/, hooks/ for Supabase .from('<table>') chains
// and flags references to columns that don't exist in lib/db-schema.json.
// Covers: .select(), .insert({...}|[{...}]), .upsert(...), .update({...}),
// and column-first-arg methods (.eq, .neq, .gt, .gte, .lt, .lte, .like,
// .ilike, .is, .in, .contains, .containedBy, .overlaps, .order, .filter,
// .textSearch).
//
// Heuristic. False positives possible when chained .from() calls share
// text; false negatives possible with dynamic column names.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const schemaPath = path.join(root, 'lib', 'db-schema.json');
const raw = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const schema = Array.isArray(raw) ? raw[0].schema : raw.schema;
const knownTables = new Set(Object.keys(schema));

const SCAN_DIRS = ['app', 'lib', 'components', 'hooks'];
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) { walk(full, out); continue; }
    if (EXTS.has(path.extname(name))) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap(d => walk(path.join(root, d)));

const COL_ARG_METHODS = [
  'eq','neq','gt','gte','lt','lte','like','ilike','is','in',
  'contains','containedBy','overlaps','order','filter','textSearch'
];

function balanceCall(src, openIdx) {
  // openIdx points at '('. Returns index of matching ')' or -1.
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function parseSelectCols(str) {
  // split by comma at depth 0
  const parts = [];
  let buf = '';
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inStr) {
      if (ch === '\\') { buf += ch + str[++i] ?? ''; continue; }
      if (ch === inStr) inStr = null;
      buf += ch;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; buf += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; buf += ch; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; buf += ch; continue; }
    if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  const cols = [];
  for (let p of parts) {
    p = p.trim();
    if (!p || p === '*') continue;
    if (p.includes('(')) continue; // nested relation
    // strip leading `!inner` style qualifiers
    // alias:col → use the column after the colon
    const colonIdx = p.indexOf(':');
    const name = colonIdx === -1 ? p : p.slice(colonIdx + 1).trim();
    // strip trailing modifiers like `col::text` casts
    const clean = name.split('::')[0].trim();
    if (/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(clean)) cols.push(clean);
  }
  return cols;
}

function parseTopLevelObjectKeys(src) {
  // src is the arg text passed to .insert()/.update()/.upsert(). May be
  // `{...}`, `[{...}, {...}]`, or an identifier. We only parse literal objects.
  const keys = [];
  const first = src.indexOf('{');
  if (first === -1) return keys;
  let depth = 0;
  let inStr = null;
  let outerDepth = 0;
  for (let i = first; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') { depth++; if (depth === 1) outerDepth = depth; continue; }
    if (ch === '}') { depth--; continue; }
    if (ch === '[' || ch === '(') { depth++; continue; }
    if (ch === ']' || ch === ')') { depth--; continue; }
    if (depth === 1) {
      const prev = src[i - 1];
      if (prev && !/[{,\s]/.test(prev)) continue;
      const m = src.slice(i).match(/^([a-zA-Z_][a-zA-Z_0-9]*)\s*:/);
      if (m) {
        keys.push(m[1]);
        i += m[0].length - 1;
      }
    }
  }
  return keys;
}

const mismatches = [];
function record(file, table, col) {
  mismatches.push({ file: path.relative(root, file).replaceAll('\\', '/'), table, col });
}

const FROM_RE = /\.from\(\s*['"`]([a-zA-Z_][a-zA-Z_0-9]*)['"`]\s*\)/g;
const SELECT_RE = /\.select\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
const COL_ARG_RE = new RegExp(
  `\\.(?:${COL_ARG_METHODS.join('|')})\\(\\s*['"\`]([a-zA-Z_][a-zA-Z_0-9]*)['"\`]`,
  'g'
);

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');

  const fromMatches = [];
  FROM_RE.lastIndex = 0;
  let m;
  while ((m = FROM_RE.exec(src))) {
    fromMatches.push({ idx: m.index, end: FROM_RE.lastIndex, table: m[1] });
  }

  for (let i = 0; i < fromMatches.length; i++) {
    const cur = fromMatches[i];
    const next = fromMatches[i + 1];
    const chunk = src.slice(cur.end, next ? next.idx : Math.min(src.length, cur.end + 6000));

    if (!knownTables.has(cur.table)) continue; // unknown table — skip silently
    const allowed = new Set(schema[cur.table]);

    // column-first-arg methods
    let mm;
    const colRe = new RegExp(COL_ARG_RE.source, 'g');
    while ((mm = colRe.exec(chunk))) {
      const col = mm[1];
      if (!allowed.has(col)) record(file, cur.table, col);
    }

    // .select('col1, col2, relation(...)')
    const sre = new RegExp(SELECT_RE.source, 'g');
    while ((mm = sre.exec(chunk))) {
      for (const c of parseSelectCols(mm[2])) {
        if (!allowed.has(c)) record(file, cur.table, c);
      }
    }

    // .insert(...), .upsert(...), .update(...)
    for (const method of ['insert', 'upsert', 'update']) {
      const mre = new RegExp(`\\.${method}\\(`, 'g');
      let im;
      while ((im = mre.exec(chunk))) {
        const open = im.index + im[0].length - 1;
        const close = balanceCall(chunk, open);
        if (close === -1) continue;
        const arg = chunk.slice(open + 1, close);
        for (const k of parseTopLevelObjectKeys(arg)) {
          if (!allowed.has(k)) record(file, cur.table, k);
        }
      }
    }
  }
}

// de-dup and sort
const seen = new Set();
const unique = mismatches.filter(x => {
  const k = `${x.file}|${x.table}|${x.col}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
}).sort((a, b) =>
  a.file.localeCompare(b.file) ||
  a.table.localeCompare(b.table) ||
  a.col.localeCompare(b.col)
);

if (unique.length === 0) {
  console.log('No column mismatches found.');
  process.exit(0);
}

const header = 'file | table | bad column';
console.log(header);
console.log('-'.repeat(header.length));
for (const x of unique) console.log(`${x.file} | ${x.table} | ${x.col}`);
console.log(`\n${unique.length} mismatch(es)`);
process.exit(1);
