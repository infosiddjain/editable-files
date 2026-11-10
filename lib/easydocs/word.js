// Word (.docx) editor: rich text page with a formatting toolbar.
import { el, tbButton, tbSep, tbColor, tbSelect, promptBox, pickFile, readAsDataURL, printHTML, modal } from './ui.js';
import { htmlToDocxBlob } from './html2docx.js';

const I = {
  undo: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  redo: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
  ul: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
  ol: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4v4M3 18h3l-3 3h3" stroke-width="1.5"/></svg>',
  left: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h14"/></svg>',
  center: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M5 18h14"/></svg>',
  right: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M10 12h10M6 18h14"/></svg>',
  justify: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  link: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  image: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  table: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/></svg>',
  clear: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 4h12M12 4l-4 16M4 20l16-16" /></svg>',
  hr: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h18"/></svg>',
};

export async function createWordEditor({ file, toolbar, workspace, status, markDirty }) {
  let html = '<p><br></p>';
  let warnings = [];
  if (file) {
    const arrayBuffer = await file.arrayBuffer();
    try {
      const res = await window.mammoth.convertToHtml({ arrayBuffer }, {
        styleMap: ['u => u', 'strike => s', "p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
      });
      html = res.value.trim() || html;
      warnings = res.messages.filter((m) => m.type === 'warning');
    } catch (e) {
      const err = new Error(e.message);
      err.userMessage = 'This doesn’t look like a valid Word (.docx) file. If it’s an older .doc file, open it in Word and save it as .docx first.';
      throw err;
    }
  }
  if (warnings.length) console.info('Word import notes:', warnings);

  const page = el('div', { class: 'page-doc', contenteditable: 'true', spellcheck: 'true', html });
  workspace.append(page);
  // make sure there is always a line to type on after a table or picture at the end
  const last = page.lastElementChild;
  if (last && /^(TABLE|IMG|HR|UL|OL)$/.test(last.tagName)) page.append(el('p', {}, el('br')));
  try { document.execCommand('styleWithCSS', false, true); } catch {}
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}

  // Remember the selection so toolbar dialogs (link, image) insert in the right place
  let savedRange = null;
  const saveSel = () => {
    const s = window.getSelection();
    if (s.rangeCount && page.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
  };
  const restoreSel = () => {
    page.focus();
    if (savedRange) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
  };
  document.addEventListener('selectionchange', saveSel);

  const exec = (cmd, val = null) => { restoreSel(); document.execCommand(cmd, false, val); changed(); refreshState(); };

  const btns = {};
  const add = (key, node) => { btns[key] = node; toolbar.append(node); return node; };

  add('undo', tbButton(I.undo, 'Undo', () => exec('undo')));
  add('redo', tbButton(I.redo, 'Redo', () => exec('redo')));
  toolbar.append(tbSep());
  const blockSel = add('block', tbSelect('Text style', [['p', 'Normal text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['blockquote', 'Quote'], ['pre', 'Code']], (v) => exec('formatBlock', `<${v}>`)));
  add('size', tbSelect('Font size', [['3', 'Size'], ['1', 'Tiny'], ['2', 'Small'], ['3', 'Normal'], ['4', 'Medium'], ['5', 'Large'], ['6', 'X-Large'], ['7', 'Huge']], (v) => exec('fontSize', v)));
  toolbar.append(tbSep());
  add('bold', tbButton('<b>B</b>', 'Bold (Ctrl+B)', () => exec('bold')));
  add('italic', tbButton('<i style="font-family:serif">I</i>', 'Italic (Ctrl+I)', () => exec('italic')));
  add('underline', tbButton('<u>U</u>', 'Underline (Ctrl+U)', () => exec('underline')));
  add('strikeThrough', tbButton('<s>S</s>', 'Strikethrough', () => exec('strikeThrough')));
  toolbar.append(tbColor('Text color', '#d0021b', (c) => exec('foreColor', c), '<b>A</b>'));
  toolbar.append(tbColor('Highlight', '#fff176', (c) => exec('hiliteColor', c), '<span style="font-size:13px">🖍</span>'));
  toolbar.append(tbSep());
  add('justifyLeft', tbButton(I.left, 'Align left', () => exec('justifyLeft')));
  add('justifyCenter', tbButton(I.center, 'Center', () => exec('justifyCenter')));
  add('justifyRight', tbButton(I.right, 'Align right', () => exec('justifyRight')));
  add('justifyFull', tbButton(I.justify, 'Justify', () => exec('justifyFull')));
  toolbar.append(tbSep());
  add('insertUnorderedList', tbButton(I.ul, 'Bulleted list', () => exec('insertUnorderedList')));
  add('insertOrderedList', tbButton(I.ol, 'Numbered list', () => exec('insertOrderedList')));
  toolbar.append(tbSep());
  toolbar.append(tbButton(I.link, 'Insert link', async () => {
    saveSel();
    const url = await promptBox('Insert link', 'Paste the web address:', 'https://', 'url');
    if (!url || url === 'https://') return;
    restoreSel();
    const sel = window.getSelection();
    if (sel.isCollapsed) document.execCommand('insertHTML', false, `<a href="${encodeURI(url)}">${url.replace(/</g, '&lt;')}</a>`);
    else document.execCommand('createLink', false, url);
    changed();
  }));
  toolbar.append(tbButton(I.image, 'Insert picture', async () => {
    saveSel();
    const f = await pickFile('image/*');
    if (!f) return;
    const url = await readAsDataURL(f);
    restoreSel();
    document.execCommand('insertImage', false, url);
    changed();
  }));
  toolbar.append(tbButton(I.table, 'Insert table', async () => {
    saveSel();
    const size = await modal((close) => {
      const r = el('input', { type: 'number', min: 1, max: 50, value: 3 });
      const c = el('input', { type: 'number', min: 1, max: 12, value: 3 });
      return el('div', {}, el('h3', {}, 'Insert table'),
        el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Rows', r), el('label', { class: 'f' }, 'Columns', c)),
        el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'),
          el('button', { class: 'btn primary', onclick: () => close([+r.value, +c.value]) }, 'Insert')));
    });
    if (!size) return;
    const [rows, cols] = size.map((n) => Math.max(1, Math.min(n || 1, 50)));
    const tr = '<tr>' + '<td><br></td>'.repeat(cols) + '</tr>';
    restoreSel();
    document.execCommand('insertHTML', false, `<table><tbody>${tr.repeat(rows)}</tbody></table><p><br></p>`);
    changed();
  }));
  toolbar.append(tbButton(I.hr, 'Horizontal line', () => exec('insertHorizontalRule')));
  toolbar.append(tbButton(I.clear, 'Clear formatting', () => exec('removeFormat')));

  function refreshState() {
    for (const k of ['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'insertUnorderedList', 'insertOrderedList']) {
      try { btns[k].classList.toggle('active', document.queryCommandState(k)); } catch {}
    }
    try {
      const b = (document.queryCommandValue('formatBlock') || 'p').toLowerCase();
      blockSel.value = ['h1', 'h2', 'h3', 'blockquote', 'pre'].includes(b) ? b : 'p';
    } catch {}
  }

  const words = el('span');
  status.append(words);
  if (warnings.length) status.append(el('span', { title: warnings.map((w) => w.message).join('\n') }, 'Some advanced Word formatting was simplified'));
  function countWords() {
    const t = page.innerText.trim();
    const n = t ? t.split(/\s+/).length : 0;
    words.textContent = `${n} word${n === 1 ? '' : 's'}`;
  }
  let wTimer;
  function changed() { markDirty(); clearTimeout(wTimer); wTimer = setTimeout(countWords, 300); }
  page.addEventListener('input', changed);
  page.addEventListener('keyup', refreshState);
  page.addEventListener('mouseup', refreshState);
  countWords();
  setTimeout(() => page.focus(), 50);

  const titleOf = (base) => base || 'Document';
  return {
    exports: [
      { label: 'Word document', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', build: () => htmlToDocxBlob(page, 'Document') },
      { label: 'PDF', ext: 'pdf', hint: 'via print → Save as PDF', print: (base) => printHTML(titleOf(base), page.innerHTML) },
      { label: 'Web page', ext: 'html', mime: 'text/html', build: async () => new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>Document</title></head><body>${page.innerHTML}</body></html>`], { type: 'text/html' }) },
      { label: 'Plain text', ext: 'txt', mime: 'text/plain', build: async () => new Blob([page.innerText], { type: 'text/plain' }) },
    ],
    destroy() { document.removeEventListener('selectionchange', saveSel); },
  };
}
