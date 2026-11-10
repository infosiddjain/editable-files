// A small, safe spreadsheet formula engine (no eval).
// Supports: numbers, "text", TRUE/FALSE, cell refs (A1, $B$2), ranges (A1:C3),
// + - * / ^ & % = <> < > <= >=, and common functions.

export class FormulaError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function colToIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function indexToCol(i) {
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let j = i + 1, s = '';
      while (j < src.length) {
        if (src[j] === '"' && src[j + 1] === '"') { s += '"'; j += 2; continue; }
        if (src[j] === '"') break;
        s += src[j++];
      }
      if (j >= src.length) throw new FormulaError('#ERROR!');
      tokens.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { tokens.push({ t: 'num', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    const ref = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?(?![A-Za-z0-9_(])/.exec(src.slice(i));
    if (ref) {
      const a = { r: +ref[2] - 1, c: colToIndex(ref[1]) };
      if (ref[3]) tokens.push({ t: 'range', a, b: { r: +ref[4] - 1, c: colToIndex(ref[3]) } });
      else tokens.push({ t: 'ref', a });
      i += ref[0].length; continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
    if (id) { tokens.push({ t: 'id', v: id[0].toUpperCase() }); i += id[0].length; continue; }
    const op = /^(<=|>=|<>|[-+*/^&=<>%(),;!:])/.exec(src.slice(i));
    if (op) { tokens.push({ t: 'op', v: op[0] === ';' ? ',' : op[0] }); i += op[0].length; continue; }
    throw new FormulaError('#ERROR!');
  }
  return tokens;
}

// Parser -> AST
function parse(src) {
  const tk = tokenize(src);
  let p = 0;
  const peek = () => tk[p];
  const isOp = (v) => tk[p] && tk[p].t === 'op' && tk[p].v === v;
  const expect = (v) => { if (!isOp(v)) throw new FormulaError('#ERROR!'); p++; };

  function comparison() {
    let left = concat();
    while (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
      const op = tk[p++].v; left = { k: 'bin', op, left, right: concat() };
    }
    return left;
  }
  function concat() {
    let left = additive();
    while (isOp('&')) { p++; left = { k: 'bin', op: '&', left, right: additive() }; }
    return left;
  }
  function additive() {
    let left = term();
    while (isOp('+') || isOp('-')) { const op = tk[p++].v; left = { k: 'bin', op, left, right: term() }; }
    return left;
  }
  function term() {
    let left = power();
    while (isOp('*') || isOp('/')) { const op = tk[p++].v; left = { k: 'bin', op, left, right: power() }; }
    return left;
  }
  function power() {
    let left = unary();
    while (isOp('^')) { p++; left = { k: 'bin', op: '^', left, right: unary() }; }
    return left;
  }
  function unary() {
    if (isOp('-')) { p++; return { k: 'neg', e: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    let e = primary();
    while (isOp('%')) { p++; e = { k: 'bin', op: '/', left: e, right: { k: 'num', v: 100 } }; }
    return e;
  }
  function primary() {
    const t = tk[p++];
    if (!t) throw new FormulaError('#ERROR!');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'ref') return { k: 'ref', a: t.a };
    if (t.t === 'range') return { k: 'range', a: t.a, b: t.b };
    if (t.t === 'id') {
      if (isOp('!')) throw new FormulaError('#REF!'); // other-sheet references aren't supported
      if (isOp('(')) {
        p++;
        const args = [];
        if (!isOp(')')) {
          do { args.push(comparison()); } while (isOp(',') && ++p);
        }
        expect(')');
        return { k: 'fn', name: t.v, args };
      }
      if (t.v === 'TRUE') return { k: 'bool', v: true };
      if (t.v === 'FALSE') return { k: 'bool', v: false };
      throw new FormulaError('#NAME?');
    }
    if (t.t === 'op' && t.v === '(') { const e = comparison(); expect(')'); return e; }
    throw new FormulaError('#ERROR!');
  }
  const ast = comparison();
  if (p < tk.length) throw new FormulaError('#ERROR!');
  return ast;
}

const toNum = (v) => {
  if (v instanceof FormulaError) throw v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === '' || v == null) return 0;
  const n = Number(v);
  if (Number.isNaN(n)) throw new FormulaError('#VALUE!');
  return n;
};
const toStr = (v) => {
  if (v instanceof FormulaError) throw v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return formatNumber(v);
  return v == null ? '' : String(v);
};
const toBool = (v) => (typeof v === 'string' ? v.toUpperCase() === 'TRUE' || (v !== '' && Number(v) !== 0 && !Number.isNaN(Number(v))) : !!toNum(v));

export function formatNumber(n) {
  if (!Number.isFinite(n)) return '#NUM!';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(12)));
}

// Flatten function args: ranges become lists of values
function flat(args, ctx) {
  const out = [];
  for (const a of args) {
    if (a.k === 'range') out.push(...rangeValues(a, ctx));
    else out.push({ v: evalNode(a, ctx), direct: true });
  }
  return out;
}
function rangeValues(node, ctx) {
  const r1 = Math.min(node.a.r, node.b.r), r2 = Math.max(node.a.r, node.b.r);
  const c1 = Math.min(node.a.c, node.b.c), c2 = Math.max(node.a.c, node.b.c);
  if ((r2 - r1 + 1) * (c2 - c1 + 1) > 1e6) throw new FormulaError('#REF!');
  const out = [];
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push({ v: ctx.get(r, c) });
  return out;
}
// Numbers from args (like Excel: text in ranges is skipped; direct text args must be numeric)
function nums(args, ctx) {
  const out = [];
  for (const { v, direct } of flat(args, ctx)) {
    if (v instanceof FormulaError) throw v;
    if (typeof v === 'number') out.push(v);
    else if (direct) out.push(toNum(v));
  }
  return out;
}

const FUNCS = {
  SUM: (a, c) => nums(a, c).reduce((s, n) => s + n, 0),
  AVERAGE: (a, c) => { const n = nums(a, c); if (!n.length) throw new FormulaError('#DIV/0!'); return n.reduce((s, x) => s + x, 0) / n.length; },
  MIN: (a, c) => { const n = nums(a, c); return n.length ? Math.min(...n) : 0; },
  MAX: (a, c) => { const n = nums(a, c); return n.length ? Math.max(...n) : 0; },
  COUNT: (a, c) => flat(a, c).filter(({ v }) => typeof v === 'number').length,
  COUNTA: (a, c) => flat(a, c).filter(({ v }) => v !== '' && v != null).length,
  PRODUCT: (a, c) => nums(a, c).reduce((s, n) => s * n, 1),
  MEDIAN: (a, c) => { const n = nums(a, c).sort((x, y) => x - y); if (!n.length) throw new FormulaError('#NUM!'); const m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
  ROUND: (a, c) => { const f = 10 ** (a[1] ? toNum(evalNode(a[1], c)) : 0); return Math.round(toNum(evalNode(a[0], c)) * f) / f; },
  ABS: (a, c) => Math.abs(toNum(evalNode(a[0], c))),
  SQRT: (a, c) => { const n = toNum(evalNode(a[0], c)); if (n < 0) throw new FormulaError('#NUM!'); return Math.sqrt(n); },
  POWER: (a, c) => toNum(evalNode(a[0], c)) ** toNum(evalNode(a[1], c)),
  MOD: (a, c) => { const d = toNum(evalNode(a[1], c)); if (!d) throw new FormulaError('#DIV/0!'); const n = toNum(evalNode(a[0], c)); return n - d * Math.floor(n / d); },
  INT: (a, c) => Math.floor(toNum(evalNode(a[0], c))),
  IF: (a, c) => (toBool(evalNode(a[0], c)) ? (a[1] ? evalNode(a[1], c) : true) : (a[2] ? evalNode(a[2], c) : false)),
  AND: (a, c) => flat(a, c).every(({ v }) => toBool(v)),
  OR: (a, c) => flat(a, c).some(({ v }) => toBool(v)),
  NOT: (a, c) => !toBool(evalNode(a[0], c)),
  CONCAT: (a, c) => flat(a, c).map(({ v }) => toStr(v)).join(''),
  CONCATENATE: (a, c) => flat(a, c).map(({ v }) => toStr(v)).join(''),
  LEN: (a, c) => toStr(evalNode(a[0], c)).length,
  UPPER: (a, c) => toStr(evalNode(a[0], c)).toUpperCase(),
  LOWER: (a, c) => toStr(evalNode(a[0], c)).toLowerCase(),
  TRIM: (a, c) => toStr(evalNode(a[0], c)).trim().replace(/\s+/g, ' '),
  TODAY: () => new Date().toISOString().slice(0, 10),
  SUMIF: (a, c) => {
    if (a[0].k !== 'range') throw new FormulaError('#VALUE!');
    const crit = evalNode(a[1], c);
    const test = criteria(crit);
    const src = rangeValues(a[0], c);
    const sums = a[2] && a[2].k === 'range' ? rangeValues(a[2], c) : src;
    return src.reduce((s, { v }, i) => (test(v) && typeof sums[i]?.v === 'number' ? s + sums[i].v : s), 0);
  },
  COUNTIF: (a, c) => {
    if (a[0].k !== 'range') throw new FormulaError('#VALUE!');
    const test = criteria(evalNode(a[1], c));
    return rangeValues(a[0], c).filter(({ v }) => test(v)).length;
  },
};
FUNCS.AVG = FUNCS.AVERAGE;

function criteria(crit) {
  const s = String(crit);
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(s);
  const op = m[1] || '=';
  const rhs = m[2];
  const rn = Number(rhs);
  return (v) => {
    const numeric = rhs !== '' && !Number.isNaN(rn) && typeof v === 'number';
    const l = numeric ? v : String(v ?? '').toLowerCase();
    const r = numeric ? rn : rhs.toLowerCase();
    switch (op) {
      case '=': return l === r; case '<>': return l !== r;
      case '<': return l < r; case '>': return l > r;
      case '<=': return l <= r; default: return l >= r;
    }
  };
}

function evalNode(n, ctx) {
  switch (n.k) {
    case 'num': return n.v;
    case 'str': return n.v;
    case 'bool': return n.v;
    case 'ref': { const v = ctx.get(n.a.r, n.a.c); if (v instanceof FormulaError) throw v; return v; }
    case 'range': throw new FormulaError('#VALUE!');
    case 'neg': return -toNum(evalNode(n.e, ctx));
    case 'fn': {
      const f = FUNCS[n.name];
      if (!f) throw new FormulaError('#NAME?');
      return f(n.args, ctx);
    }
    case 'bin': {
      const l = evalNode(n.left, ctx), r = evalNode(n.right, ctx);
      switch (n.op) {
        case '+': return toNum(l) + toNum(r);
        case '-': return toNum(l) - toNum(r);
        case '*': return toNum(l) * toNum(r);
        case '/': { const d = toNum(r); if (d === 0) throw new FormulaError('#DIV/0!'); return toNum(l) / d; }
        case '^': return toNum(l) ** toNum(r);
        case '&': return toStr(l) + toStr(r);
        default: {
          const both = typeof l === 'number' && typeof r === 'number';
          const a = both ? l : toStr(l).toLowerCase(), b = both ? r : toStr(r).toLowerCase();
          switch (n.op) {
            case '=': return a === b; case '<>': return a !== b;
            case '<': return a < b; case '>': return a > b;
            case '<=': return a <= b; default: return a >= b;
          }
        }
      }
    }
  }
  throw new FormulaError('#ERROR!');
}

// Parse a typed value: numbers become numbers, everything else stays text.
export function literal(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return Number(s);
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  if (/^TRUE$/i.test(s)) return true;
  if (/^FALSE$/i.test(s)) return false;
  return raw;
}

// Evaluates every cell in a sheet. `data` is a 2D array of raw strings.
// Returns a function (r, c) => value (number | string | boolean | FormulaError).
export function evaluateSheet(data) {
  const memo = new Map();
  const visiting = new Set();
  const astCache = new Map();
  const get = (r, c) => {
    const key = r * 100000 + c;
    if (memo.has(key)) return memo.get(key);
    const raw = data[r]?.[c] ?? '';
    let v;
    if (typeof raw === 'string' && raw.startsWith('=') && raw.length > 1) {
      if (visiting.has(key)) return new FormulaError('#CYCLE!');
      visiting.add(key);
      try {
        let ast = astCache.get(raw);
        if (!ast) { ast = parse(raw.slice(1)); astCache.set(raw, ast); }
        v = evalNode(ast, ctx);
        if (typeof v === 'number' && !Number.isFinite(v)) v = new FormulaError('#NUM!');
      } catch (e) {
        v = e instanceof FormulaError ? e : new FormulaError('#ERROR!');
      }
      visiting.delete(key);
    } else v = literal(raw);
    memo.set(key, v);
    return v;
  };
  const ctx = { get };
  return get;
}
