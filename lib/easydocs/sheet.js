// Spreadsheet editor for .xlsx / .xls / .ods / .csv files.
import { el, tbButton, tbSep, promptBox, confirmBox, printHTML, escapeHTML, toast } from './ui.js';
import { evaluateSheet, FormulaError, formatNumber, indexToCol, literal } from './formula.js';

const XLSX = window.XLSX; // SheetJS, loaded from /public/vendor

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
};

function readWorkbook(wb) {
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const data = [];
    const cached = new Map();
    if (ws['!ref']) {
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (!cell) continue;
          let raw;
          if (cell.f) {
            raw = '=' + cell.f;
            if (cell.w != null || cell.v != null) cached.set(r + ',' + c, { raw, text: cell.w ?? String(cell.v) });
          } else if (cell.t === 'n') raw = cell.z && /%/.test(cell.z) && cell.w ? cell.w : String(cell.v);
          else if (cell.t === 'd') raw = cell.w ?? String(cell.v);
          else if (cell.t === 'b') raw = cell.v ? 'TRUE' : 'FALSE';
          else if (cell.t === 'e') raw = cell.w ?? '#ERROR!';
          else raw = cell.v == null ? '' : String(cell.v);
          (data[r] ||= [])[c] = raw;
        }
      }
    }
    for (let r = 0; r < data.length; r++) data[r] ||= [];
    return { name, data, cached, cols: ws['!cols'], merges: ws['!merges'] };
  });
}

export async function createSheetEditor({ file, ext, toolbar, workspace, status, markDirty }) {
  let sheets;
  if (file) {
    let wb;
    try {
      if (ext === 'csv' || ext === 'tsv') {
        const text = await file.text();
        wb = XLSX.read(text, { type: 'string', raw: true, FS: ext === 'tsv' ? '\t' : undefined });
      } else {
        wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellFormula: true, cellDates: true, cellNF: true });
      }
    } catch (e) {
      const err = new Error(e.message);
      err.userMessage = 'This spreadsheet couldn’t be read. It may be damaged or password-protected.';
      throw err;
    }
    sheets = readWorkbook(wb);
    if (!sheets.length) sheets = [{ name: 'Sheet1', data: [], cached: new Map() }];
  } else {
    sheets = [{ name: 'Sheet1', data: [], cached: new Map() }];
  }

  let cur = 0;
  let sel = { r: 0, c: 0 }, anchor = { r: 0, c: 0 };
  let values = null; // evaluator for current sheet
  let nRows = 0, nCols = 0;
  let editing = null; // { input, r, c }

  const S = () => sheets[cur];

  // ---- layout ----
  const nameBox = el('span', { class: 'cell-name' }, 'A1');
  const fx = el('input', { 'aria-label': 'Cell contents', spellcheck: 'false', placeholder: 'Type a value or a formula like =SUM(A1:A5)' });
  const bar = el('div', { class: 'formula-bar' }, nameBox, el('span', { class: 'fx' }, 'fx'), fx);
  const table = el('table', { class: 'grid' });
  const wrap = el('div', { class: 'sheet-wrap', tabindex: '0' }, table);
  const tabs = el('div', { class: 'sheet-tabs' });
  const layout = el('div', { class: 'sheet-layout' }, bar, wrap, tabs);
  workspace.append(layout);
  const info = el('span');
  status.append(info);

  // ---- toolbar ----
  toolbar.append(
    tbButton('<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>', 'Undo (Ctrl+Z)', () => undo()),
    tbSep(),
    tbButton('+ Row', 'Insert row above', () => insertRow(sel.r)),
    tbButton('+ Column', 'Insert column to the left', () => insertCol(sel.c)),
    tbButton('− Row', 'Delete row', () => deleteRow()),
    tbButton('− Column', 'Delete column', () => deleteCol()),
    tbSep(),
    tbButton('A→Z', 'Sort rows by this column (keeps row 1 as header)', () => sortBy(1)),
    tbButton('Z→A', 'Sort rows by this column, descending (keeps row 1 as header)', () => sortBy(-1)),
    tbSep(),
    tbButton('Σ Sum', 'Insert a SUM of the numbers above', () => autoSum()),
    tbSep(),
    tbButton('+ Sheet', 'Add a sheet', () => addSheet()),
    tbButton('Rename', 'Rename this sheet', () => renameSheet()),
    tbButton('Delete sheet', 'Delete this sheet', () => deleteSheet()),
  );

  // ---- undo ----
  const history = [];
  function snapshot() {
    history.push({ cur, sheets: sheets.map((s) => ({ ...s, data: s.data.map((r) => r.slice()) })) });
    if (history.length > 100) history.shift();
  }
  function undo() {
    const h = history.pop();
    if (!h) return toast('Nothing to undo');
    sheets = h.sheets; cur = Math.min(h.cur, sheets.length - 1);
    render(); markDirty();
  }

  // ---- data helpers ----
  const getRaw = (r, c) => S().data[r]?.[c] ?? '';
  function setRaw(r, c, v) {
    const d = S().data;
    while (d.length <= r) d.push([]);
    d[r][c] = v;
  }
  function usedSize(data) {
    let rows = 0, cols = 0;
    data.forEach((row, r) => row.forEach((v, c) => { if (v !== '' && v != null) { rows = Math.max(rows, r + 1); cols = Math.max(cols, c + 1); } }));
    return { rows, cols };
  }

  function display(r, c) {
    const v = values(r, c);
    if (v instanceof FormulaError) {
      const cached = S().cached.get(r + ',' + c);
      if (cached && cached.raw === getRaw(r, c)) return { text: cached.text, num: !isNaN(parseFloat(cached.text)) };
      return { text: v.code, err: true };
    }
    if (typeof v === 'number') return { text: formatNumber(v), num: true };
    if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', num: true };
    return { text: v == null ? '' : String(v) };
  }

  // ---- render ----
  function render() {
    stopEdit(false);
    const used = usedSize(S().data);
    nRows = Math.max(used.rows + 30, 60);
    nCols = Math.max(used.cols + 5, 15);
    values = evaluateSheet(S().data);
    const head = el('tr', {}, el('th', {}, ''));
    for (let c = 0; c < nCols; c++) head.append(el('th', { 'data-c': c }, indexToCol(c)));
    const body = document.createDocumentFragment();
    for (let r = 0; r < nRows; r++) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = r + 1;
      th.dataset.r = r;
      tr.append(th);
      for (let c = 0; c < nCols; c++) {
        const td = document.createElement('td');
        td.dataset.r = r; td.dataset.c = c;
        const d = display(r, c);
        if (d.text) td.textContent = d.text;
        if (d.num) td.className = 'num';
        if (d.err) td.className = 'err';
        tr.append(td);
      }
      body.append(tr);
    }
    const thead = el('thead', {}, head);
    const tbody = el('tbody');
    tbody.append(body);
    table.replaceChildren(thead, tbody);
    // keep original column widths if the file had them
    const cols = S().cols;
    if (cols) cols.forEach((col, c) => {
      const w = col?.wpx || (col?.wch ? col.wch * 7 + 10 : null);
      const th = head.children[c + 1];
      if (w && th) th.style.minWidth = th.style.maxWidth = Math.max(40, Math.min(w, 400)) + 'px';
    });
    sel.r = Math.min(sel.r, nRows - 1); sel.c = Math.min(sel.c, nCols - 1);
    renderTabs();
    paintSelection();
    info.textContent = `${used.rows} rows × ${used.cols} columns`;
  }

  function refreshValues() {
    values = evaluateSheet(S().data);
    const used = usedSize(S().data);
    if (used.rows + 5 > nRows || used.cols + 2 > nCols) return render();
    for (const td of table.tBodies[0].querySelectorAll('td')) {
      const d = display(+td.dataset.r, +td.dataset.c);
      if (td.textContent !== d.text) td.textContent = d.text;
      const cls = d.err ? 'err' : d.num ? 'num' : '';
      td.classList.toggle('num', cls === 'num');
      td.classList.toggle('err', cls === 'err');
    }
    paintSelection();
    info.textContent = `${used.rows} rows × ${used.cols} columns`;
  }

  function renderTabs() {
    tabs.replaceChildren(...sheets.map((s, i) => {
      const b = el('button', { class: 'sheet-tab' + (i === cur ? ' active' : ''), title: 'Double-click to rename' }, s.name);
      b.addEventListener('click', () => { if (i !== cur) { cur = i; sel = { r: 0, c: 0 }; anchor = { ...sel }; render(); } });
      b.addEventListener('dblclick', () => renameSheet());
      return b;
    }));
  }

  const cellAt = (r, c) => table.tBodies[0]?.rows[r]?.cells[c + 1];
  function rangeBounds() {
    return { r1: Math.min(sel.r, anchor.r), r2: Math.max(sel.r, anchor.r), c1: Math.min(sel.c, anchor.c), c2: Math.max(sel.c, anchor.c) };
  }
  function paintSelection() {
    table.querySelectorAll('.sel, .rng, .hl').forEach((n) => n.classList.remove('sel', 'rng', 'hl'));
    const { r1, r2, c1, c2 } = rangeBounds();
    if (r2 - r1 + c2 - c1 > 0 && (r2 - r1 + 1) * (c2 - c1 + 1) < 20000) {
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) cellAt(r, c)?.classList.add('rng');
    }
    cellAt(sel.r, sel.c)?.classList.add('sel');
    table.tHead?.rows[0].cells[sel.c + 1]?.classList.add('hl');
    table.tBodies[0]?.rows[sel.r]?.cells[0]?.classList.add('hl');
    nameBox.textContent = indexToCol(sel.c) + (sel.r + 1) + (r2 - r1 + c2 - c1 > 0 ? `:${indexToCol(c2)}${r2 + 1}` : '');
    if (document.activeElement !== fx) fx.value = getRaw(sel.r, sel.c);
  }

  function select(r, c, extend = false) {
    sel = { r: Math.max(0, Math.min(r, nRows - 1)), c: Math.max(0, Math.min(c, nCols - 1)) };
    if (!extend) anchor = { ...sel };
    paintSelection();
    const td = cellAt(sel.r, sel.c);
    if (td) {
      // keep the cell visible, accounting for sticky headers
      const w = wrap.getBoundingClientRect(), t = td.getBoundingClientRect();
      if (t.top < w.top + 28) wrap.scrollTop -= w.top + 28 - t.top;
      else if (t.bottom > w.bottom) wrap.scrollTop += t.bottom - w.bottom;
      if (t.left < w.left + 46) wrap.scrollLeft -= w.left + 46 - t.left;
      else if (t.right > w.right) wrap.scrollLeft += t.right - w.right;
    }
  }

  function commit(r, c, raw) {
    if (getRaw(r, c) === raw) return;
    snapshot();
    setRaw(r, c, raw);
    markDirty();
    refreshValues();
  }

  // ---- in-cell editing ----
  function startEdit(initial) {
    stopEdit(true);
    const td = cellAt(sel.r, sel.c);
    if (!td) return;
    const w = wrap.getBoundingClientRect(), t = td.getBoundingClientRect();
    const input = el('input', { class: 'cell-editor', spellcheck: 'false' });
    Object.assign(input.style, {
      left: t.left - w.left + wrap.scrollLeft + 'px', top: t.top - w.top + wrap.scrollTop + 'px',
      width: Math.max(t.width, 120) + 'px', height: t.height + 'px',
    });
    input.value = initial ?? getRaw(sel.r, sel.c);
    editing = { input, r: sel.r, c: sel.c };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); stopEdit(true); select(sel.r + (e.shiftKey ? -1 : 1), sel.c); wrap.focus(); }
      else if (e.key === 'Tab') { e.preventDefault(); stopEdit(true); select(sel.r, sel.c + (e.shiftKey ? -1 : 1)); wrap.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); stopEdit(false); wrap.focus(); }
    });
    input.addEventListener('input', () => { fx.value = input.value; });
    input.addEventListener('blur', () => stopEdit(true));
    wrap.append(input);
    input.focus();
    const len = input.value.length;
    input.setSelectionRange(len, len);
  }
  function stopEdit(save) {
    if (!editing) return;
    const { input, r, c } = editing;
    editing = null;
    input.remove();
    if (save) commit(r, c, input.value);
  }

  // ---- events ----
  let dragging = false;
  table.addEventListener('pointerdown', (e) => {
    const td = e.target.closest('td');
    const th = e.target.closest('th');
    if (td) {
      const again = e.pointerType !== 'mouse' && +td.dataset.r === sel.r && +td.dataset.c === sel.c && !editing;
      stopEdit(true);
      select(+td.dataset.r, +td.dataset.c, e.shiftKey);
      if (again) { e.preventDefault(); startEdit(); return; } // phones: tap a selected cell again to type
      dragging = true;
      wrap.focus({ preventScroll: true });
    } else if (th && th.dataset.c != null) { // whole column
      stopEdit(true);
      anchor = { r: 0, c: +th.dataset.c }; sel = { r: nRows - 1, c: +th.dataset.c }; paintSelection();
    } else if (th && th.dataset.r != null) { // whole row
      stopEdit(true);
      anchor = { r: +th.dataset.r, c: 0 }; sel = { r: +th.dataset.r, c: nCols - 1 }; paintSelection();
    }
  });
  table.addEventListener('pointerover', (e) => {
    if (!dragging || e.pointerType === 'touch') return;
    const td = e.target.closest('td');
    if (td) { sel = { r: +td.dataset.r, c: +td.dataset.c }; paintSelection(); }
  });
  const stopDrag = () => { dragging = false; };
  document.addEventListener('pointerup', stopDrag);
  table.addEventListener('dblclick', (e) => { if (e.target.closest('td')) startEdit(); });

  wrap.addEventListener('keydown', (e) => {
    if (editing || e.target !== wrap) return;
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (mod) return; // let copy/paste events through
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[k]) { e.preventDefault(); select(sel.r + moves[k][0], sel.c + moves[k][1], e.shiftKey); return; }
    if (k === 'Enter') { e.preventDefault(); startEdit(); return; }
    if (k === 'F2') { e.preventDefault(); startEdit(); return; }
    if (k === 'Tab') { e.preventDefault(); select(sel.r, sel.c + (e.shiftKey ? -1 : 1)); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearRange(); return; }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); startEdit(k); }
  });

  fx.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(sel.r, sel.c, fx.value); select(sel.r + 1, sel.c); wrap.focus(); }
    if (e.key === 'Escape') { fx.value = getRaw(sel.r, sel.c); wrap.focus(); }
  });
  fx.addEventListener('change', () => commit(sel.r, sel.c, fx.value));

  function clearRange() {
    const { r1, r2, c1, c2 } = rangeBounds();
    snapshot();
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (S().data[r]?.[c] != null) S().data[r][c] = '';
    markDirty(); refreshValues();
  }

  const onCopy = (e) => {
    if (document.activeElement !== wrap) return;
    const { r1, r2, c1, c2 } = rangeBounds();
    const lines = [];
    for (let r = r1; r <= r2; r++) {
      const row = [];
      for (let c = c1; c <= c2; c++) row.push(display(r, c).text);
      lines.push(row.join('\t'));
    }
    e.clipboardData.setData('text/plain', lines.join('\n'));
    e.preventDefault();
    return true;
  };
  const onCut = (e) => { if (onCopy(e)) clearRange(); };
  const onPaste = (e) => {
    if (document.activeElement !== wrap) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    snapshot();
    rows.forEach((row, i) => row.forEach((v, j) => setRaw(sel.r + i, sel.c + j, v)));
    anchor = { ...sel };
    sel = { r: sel.r + rows.length - 1, c: sel.c + Math.max(...rows.map((r) => r.length)) - 1 };
    markDirty(); refreshValues();
  };
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCut);
  document.addEventListener('paste', onPaste);

  // ---- structure ops ----
  function structural(fn) {
    stopEdit(true);
    snapshot();
    fn(S().data);
    S().merges = undefined; S().cached = new Map();
    markDirty(); render();
  }
  const insertRow = (at) => structural((d) => { while (d.length < at) d.push([]); d.splice(at, 0, []); });
  const insertCol = (at) => structural((d) => d.forEach((row) => { if (row.length > at) row.splice(at, 0, ''); }));
  function deleteRow() {
    const { r1, r2 } = rangeBounds();
    structural((d) => d.splice(r1, r2 - r1 + 1));
  }
  function deleteCol() {
    const { c1, c2 } = rangeBounds();
    structural((d) => d.forEach((row) => row.splice(c1, c2 - c1 + 1)));
  }
  function sortBy(dir) {
    const c = sel.c;
    structural((d) => {
      const header = d.slice(0, 1);
      const rest = d.slice(1).filter((row) => row.some((v) => v !== '' && v != null));
      rest.sort((a, b) => {
        const x = literal(a[c] ?? ''), y = literal(b[c] ?? '');
        if (x === '' && y !== '') return 1;
        if (y === '' && x !== '') return -1;
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
        return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
      });
      d.splice(0, d.length, ...header, ...rest);
    });
    toast('Sorted by column ' + indexToCol(c));
  }
  function autoSum() {
    let top = sel.r - 1;
    while (top >= 0 && typeof values(top, sel.c) === 'number') top--;
    if (top === sel.r - 1) return toast('No numbers directly above this cell');
    const col = indexToCol(sel.c);
    commit(sel.r, sel.c, `=SUM(${col}${top + 2}:${col}${sel.r})`);
  }
  async function addSheet() {
    stopEdit(true);
    snapshot();
    let n = sheets.length + 1;
    while (sheets.some((s) => s.name === 'Sheet' + n)) n++;
    sheets.push({ name: 'Sheet' + n, data: [], cached: new Map() });
    cur = sheets.length - 1; sel = { r: 0, c: 0 }; anchor = { ...sel };
    markDirty(); render();
  }
  async function renameSheet() {
    const name = await promptBox('Rename sheet', null, S().name);
    const clean = name?.replace(/[\\/?*[\]:]/g, '').trim().slice(0, 31);
    if (!clean || clean === S().name) return;
    if (sheets.some((s) => s.name === clean)) return toast('A sheet with that name already exists');
    snapshot();
    S().name = clean; markDirty(); renderTabs();
  }
  async function deleteSheet() {
    if (sheets.length === 1) return toast('A workbook needs at least one sheet');
    if (!(await confirmBox('Delete sheet?', `“${S().name}” and everything in it will be removed.`, 'Delete', true))) return;
    snapshot();
    sheets.splice(cur, 1); cur = Math.max(0, cur - 1);
    markDirty(); render();
  }

  // ---- export ----
  function toWorksheet(s) {
    const get = evaluateSheet(s.data);
    const ws = {};
    const used = usedSize(s.data);
    for (let r = 0; r < used.rows; r++) {
      for (let c = 0; c < used.cols; c++) {
        const raw = s.data[r]?.[c];
        if (raw === '' || raw == null) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        if (typeof raw === 'string' && raw.startsWith('=') && raw.length > 1) {
          const v = get(r, c);
          const cell = { f: raw.slice(1) };
          if (v instanceof FormulaError) {
            const cached = s.cached.get(r + ',' + c);
            if (cached) { const n = literal(cached.text); cell.t = typeof n === 'number' ? 'n' : 's'; cell.v = n; }
            else { cell.t = 'e'; cell.v = 0x0f; }
          } else if (typeof v === 'number') { cell.t = 'n'; cell.v = v; }
          else if (typeof v === 'boolean') { cell.t = 'b'; cell.v = v; }
          else { cell.t = 's'; cell.v = String(v); }
          ws[addr] = cell;
        } else {
          const v = literal(raw);
          if (typeof v === 'number') ws[addr] = { t: 'n', v };
          else if (typeof v === 'boolean') ws[addr] = { t: 'b', v };
          else ws[addr] = { t: 's', v: String(raw) };
        }
      }
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, used.rows - 1), c: Math.max(0, used.cols - 1) } });
    if (s.cols) ws['!cols'] = s.cols;
    if (s.merges) ws['!merges'] = s.merges;
    return ws;
  }
  function workbook() {
    stopEdit(true);
    const wb = XLSX.utils.book_new();
    for (const s of sheets) XLSX.utils.book_append_sheet(wb, toWorksheet(s), s.name);
    return wb;
  }
  const binary = (bookType, ext) => async () => new Blob([XLSX.write(workbook(), { bookType, type: 'array' })], { type: MIME[ext] });
  const delimited = (sep, ext) => async () => {
    stopEdit(true);
    const text = XLSX.utils.sheet_to_csv(toWorksheet(S()), { FS: sep, blankrows: true });
    return new Blob(['﻿' + text], { type: MIME[ext] + ';charset=utf-8' });
  };

  const all = {
    xlsx: { label: 'Excel workbook', ext: 'xlsx', mime: MIME.xlsx, build: binary('xlsx', 'xlsx') },
    xls: { label: 'Excel 97–2003', ext: 'xls', mime: MIME.xls, build: binary('biff8', 'xls') },
    ods: { label: 'OpenDocument sheet', ext: 'ods', mime: MIME.ods, build: binary('ods', 'ods') },
    csv: { label: 'CSV (this sheet)', ext: 'csv', mime: MIME.csv, build: delimited(',', 'csv') },
    tsv: { label: 'TSV (this sheet)', ext: 'tsv', mime: MIME.tsv, build: delimited('\t', 'tsv') },
    pdf: {
      label: 'PDF (this sheet)', ext: 'pdf', hint: 'via print → Save as PDF',
      print: (base) => {
        stopEdit(true);
        const used = usedSize(S().data);
        let h = '<table>';
        for (let r = 0; r < used.rows; r++) {
          h += '<tr>';
          for (let c = 0; c < used.cols; c++) { const d = display(r, c); h += `<td${d.num ? ' style="text-align:right"' : ''}>${escapeHTML(d.text)}</td>`; }
          h += '</tr>';
        }
        printHTML(base, h + '</table>', 'body{font-size:10pt}');
      },
    },
  };
  const first = ['xls', 'ods', 'csv', 'tsv'].includes(ext) ? ext : 'xlsx';
  const order = [first, ...['xlsx', 'csv', 'ods', 'xls', 'tsv', 'pdf'].filter((k) => k !== first)];

  render();
  setTimeout(() => wrap.focus(), 50);

  return {
    exports: order.map((k) => all[k]),
    destroy() {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('pointerup', stopDrag);
    },
  };
}
