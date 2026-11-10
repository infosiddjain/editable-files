// Plain text / code editor (txt, md, json, html, csv-as-text, etc.)
import { el, tbButton, tbSep, toast } from './ui.js';

const MIME = {
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', json: 'application/json', html: 'text/html', htm: 'text/html',
  xml: 'application/xml', js: 'text/javascript', css: 'text/css', csv: 'text/csv', svg: 'image/svg+xml', yml: 'text/yaml', yaml: 'text/yaml',
};

export async function createTextEditor({ file, ext, toolbar, workspace, status, markDirty }) {
  const text = file ? await file.text() : '';
  const area = el('textarea', { class: 'text-area', spellcheck: ['txt', 'md', 'markdown', ''].includes(ext) ? 'true' : 'false', 'aria-label': 'File contents' });
  area.value = text;

  // Find & replace
  const findIn = el('input', { placeholder: 'Find', 'aria-label': 'Find' });
  const replIn = el('input', { placeholder: 'Replace with', 'aria-label': 'Replace with' });
  const count = el('span', { style: { fontSize: '13px', color: 'var(--muted)' } });
  let lastIndex = 0;
  const findNext = () => {
    const q = findIn.value;
    if (!q) return;
    const hay = area.value.toLowerCase(), needle = q.toLowerCase();
    let i = hay.indexOf(needle, lastIndex);
    if (i < 0) i = hay.indexOf(needle, 0);
    const total = hay.split(needle).length - 1;
    count.textContent = total ? `${total} found` : 'Not found';
    if (i < 0) return;
    area.focus();
    area.setSelectionRange(i, i + q.length);
    lastIndex = i + q.length;
    // scroll the match into view
    const line = area.value.slice(0, i).split('\n').length;
    area.scrollTop = Math.max(0, (line - 5) * parseFloat(getComputedStyle(area).lineHeight || 22));
  };
  const replaceAll = () => {
    const q = findIn.value;
    if (!q) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const n = (area.value.match(re) || []).length;
    if (!n) return toast('Nothing to replace');
    area.focus();
    area.select();
    // execCommand keeps native undo working; fall back to direct assignment
    const next = area.value.replace(re, () => replIn.value);
    if (!document.execCommand('insertText', false, next)) area.value = next;
    changed();
    toast(`Replaced ${n} match${n === 1 ? '' : 'es'}`);
  };
  findIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(); } });
  const findBar = el('div', { class: 'find-bar', hidden: true }, findIn, el('button', { class: 'btn', onclick: findNext }, 'Find next'), replIn,
    el('button', { class: 'btn', onclick: replaceAll }, 'Replace all'), count);

  workspace.append(el('div', { class: 'text-layout' }, findBar, area));

  let size = 14;
  toolbar.append(
    tbButton('🔍 Find', 'Find & replace (Ctrl+F)', () => { findBar.hidden = !findBar.hidden; if (!findBar.hidden) findIn.focus(); }),
    tbSep(),
    tbButton('A−', 'Smaller text', () => { size = Math.max(10, size - 1); area.style.fontSize = size + 'px'; }),
    tbButton('A+', 'Bigger text', () => { size = Math.min(28, size + 1); area.style.fontSize = size + 'px'; }),
    tbButton('↩ Wrap', 'Toggle word wrap', (e) => { area.classList.toggle('wrap-off'); e.currentTarget.classList.toggle('active', !area.classList.contains('wrap-off')); }, 'active'),
  );
  if (ext === 'json') {
    toolbar.append(tbSep(), tbButton('{ } Format', 'Pretty-print JSON', () => {
      try {
        const pretty = JSON.stringify(JSON.parse(area.value), null, 2);
        area.focus(); area.select();
        if (!document.execCommand('insertText', false, pretty)) area.value = pretty;
        changed();
      } catch (e) { toast('Not valid JSON: ' + e.message, 4000); }
    }));
  }

  area.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (!document.execCommand('insertText', false, '\t')) area.setRangeText('\t', area.selectionStart, area.selectionEnd, 'end');
      changed();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); findBar.hidden = false; findIn.focus(); }
  });

  const info = el('span');
  status.append(info);
  const updateInfo = () => {
    const v = area.value;
    const lines = v ? v.split('\n').length : 0;
    const words = v.trim() ? v.trim().split(/\s+/).length : 0;
    info.textContent = `${lines} lines · ${words} words · ${v.length} characters`;
  };
  let t;
  function changed() { markDirty(); clearTimeout(t); t = setTimeout(updateInfo, 200); }
  area.addEventListener('input', changed);
  updateInfo();
  setTimeout(() => area.focus(), 50);

  const ownExt = ext || 'txt';
  const exports = [{ label: 'Same format', ext: ownExt, mime: MIME[ownExt] || 'text/plain', build: async () => new Blob([area.value], { type: (MIME[ownExt] || 'text/plain') + ';charset=utf-8' }) }];
  if (ownExt !== 'txt') exports.push({ label: 'Plain text', ext: 'txt', mime: 'text/plain', build: async () => new Blob([area.value], { type: 'text/plain;charset=utf-8' }) });
  return { exports };
}
